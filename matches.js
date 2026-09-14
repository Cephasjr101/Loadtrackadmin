import { Router } from "express";
import { randomInt } from "node:crypto";
import { db, uid, save } from "../db.js";
import { requireAuth } from "../lib/auth.js";
import { config } from "../config.js";
import { scoreMatch, findMatches } from "../lib/matching.js";
import { paystackEnabled } from "../config.js";
import { initializeTransaction, newReference } from "../lib/paystack.js";
import {
  createMatchSchema, signSchema, trackSchema, otpSchema, parse,
} from "../lib/validators.js";

const r = Router();

/* Run the matching engine over all live trucks/loads */
r.post("/run", requireAuth, (req, res) => {
  res.json({ matches: findMatches(db.trucks, db.loads) });
});

/* Create a match (proposed deal) from a truck + load */
r.post("/", requireAuth, (req, res) => {
  const d = parse(createMatchSchema, req.body);
  const truck = db.trucks.find((t) => t.id === d.truckId);
  const load = db.loads.find((l) => l.id === d.loadId);
  if (!truck || !load) return res.status(404).json({ error: "Truck or load not found" });

  const m = scoreMatch(truck, load);
  if (!m) return res.status(422).json({ error: "Truck cannot carry this load (route/capacity/dates)" });

  const priceGhs = d.priceGhs ?? m.estGhs;
  const commissionPct = Math.min(
    config.commission.max,
    Math.max(config.commission.min, d.commissionPct ?? config.commission.default),
  );

  const match = {
    id: uid("M"),
    truckId: truck.id, loadId: load.id,
    carrierId: truck.ownerId, shipperId: load.shipperId,
    priceGhs, commissionPct,
    status: "proposed",                    // proposed → contract_signed → escrow_funded → in_transit → delivered
    escrowStatus: "awaiting_funding",      // awaiting_funding → held → released
    signatures: {},                        // { carrier: {name, at}, shipper: {...} }
    deliveryOtp: null,
    progress: 0,
    contract: contractText(truck, load, priceGhs, commissionPct),
    createdAt: new Date().toISOString(),
  };
  db.matches.push(match); save();
  res.status(201).json({ match: publicMatch(match, req.user) });
});

function contractText(truck, load, price, pct) {
  return [
    "LOADMATCH TRANSPORT CONTRACT",
    `Carrier: ${truck.owner} — ${truck.truckType} ${truck.plateNo}${truck.verified ? " (Verified)" : ""}`,
    `Shipper: ${load.company}`,
    `Route: ${truck.from} -> ${truck.to}`,
    `Cargo: ${load.cargo} — ${load.weightKg} kg, ${load.volumeM3} m3`,
    `Window: pickup ${load.pickupDate} -> deliver by ${load.deliveryDate}`,
    `Price: GHS ${price} (escrow-protected)`,
    `Commission: ${pct}% to LoadMatch`,
    "Terms: GPS enabled during transit; payment released on recipient OTP; carrier liability up to declared value; disputes within 14 days, courts of Ghana.",
  ].join("\n");
}

function getMatch(req, res) {
  const m = db.matches.find((x) => x.id === req.params.id);
  if (!m) { res.status(404).json({ error: "Match not found" }); return null; }
  const party = [m.carrierId, m.shipperId].includes(req.user.id);
  if (!party) { res.status(403).json({ error: "Not a party to this match" }); return null; }
  return m;
}

const pub = (m, user) => publicMatch(m, user);
function publicMatch(m, user) {
  const out = { ...m, contract: undefined };
  // OTP is visible only to the shipper (recipient side) until delivered.
  // NB: `delete`, not omission — the spread above already copied the raw value.
  if (user && user.id === m.shipperId) out.deliveryOtp = m.deliveryOtp;
  else delete out.deliveryOtp;
  return { ...out, contract: m.contract };
}

r.get("/:id", requireAuth, (req, res) => {
  const m = getMatch(req, res); if (!m) return;
  const comm = Math.round((m.priceGhs * m.commissionPct) / 100);
  res.json({
    match: pub(m, req.user),
    escrow: {
      status: m.escrowStatus,
      commissionGhs: comm,
      carrierPayoutGhs: m.priceGhs - comm,
      breakdown: { priceGhs: m.priceGhs, commissionPct: m.commissionPct, commissionGhs: comm, payoutGhs: m.priceGhs - comm },
    },
  });
});

r.get("/", requireAuth, (req, res) => {
  const mine = db.matches.filter(
    (m) => m.carrierId === req.user.id || m.shipperId === req.user.id,
  );
  res.json({ matches: mine.map((m) => pub(m, req.user)) });
});

/* e-sign: both parties must sign → contract_signed */
r.post("/:id/sign", requireAuth, (req, res) => {
  const m = getMatch(req, res); if (!m) return;
  const d = parse(signSchema, req.body);
  if (m.status !== "proposed") return res.status(409).json({ error: "Contract already " + m.status });
  m.signatures[req.user.role] = { name: d.signerName, at: new Date().toISOString() };
  if (m.signatures.carrier && m.signatures.shipper) m.status = "contract_signed";
  save();
  res.json({ match: pub(m, req.user) });
});

/* escrow funding (shipper).
 * Real mode: POST /:id/pay/initialize → Paystack inline checkout → webhook settles.
 * Simulation mode (no PAYSTACK_SECRET_KEY, or body.simulate=true): escrow held directly. */
r.post("/:id/fund", requireAuth, (req, res) => {
  const m = getMatch(req, res); if (!m) return;
  if (req.user.id !== m.shipperId) return res.status(403).json({ error: "Only the shipper funds escrow" });
  if (m.status !== "contract_signed") return res.status(409).json({ error: "Both parties must sign first" });
  if (m.escrowStatus !== "awaiting_funding") return res.status(409).json({ error: "Escrow is " + m.escrowStatus });
  m.escrowStatus = "held";
  m.status = "ready_for_pickup";
  m.payment = { provider: "simulation", reference: "SIM-" + m.id, amountGhs: m.priceGhs,
                paidAt: new Date().toISOString() };
  save();
  res.json({ match: pub(m, req.user), simulated: true });
});

/* Initialize a real Paystack checkout for this match (shipper only). */
r.post("/:id/pay/initialize", requireAuth, async (req, res) => {
  const m = getMatch(req, res); if (!m) return;
  if (!paystackEnabled()) {
    return res.status(409).json({ error: "Paystack not configured — use POST /:id/fund with {simulate:true}" });
  }
  if (req.user.id !== m.shipperId) return res.status(403).json({ error: "Only the shipper pays" });
  if (m.status !== "contract_signed") return res.status(409).json({ error: "Both parties must sign first" });
  if (m.escrowStatus === "held") return res.status(409).json({ error: "Escrow already funded" });

  const reference = newReference(m.id);
  m.pendingReference = reference;
  save();
  try {
    const tx = await initializeTransaction({
      email: req.user.email,
      amountGhs: m.priceGhs,
      reference,
      callbackUrl: config.paystack.callbackUrl || undefined,
      metadata: { matchId: m.id, shipperId: m.shipperId, carrierId: m.carrierId },
    });
    res.json({ authorizationUrl: tx.authorization_url, reference, amountGhs: m.priceGhs });
  } catch (e) {
    m.pendingReference = null; save();
    res.status(e.status || 502).json({ error: e.message });
  }
});

/* departure (carrier) → generates the delivery OTP for the recipient */
r.post("/:id/depart", requireAuth, (req, res) => {
  const m = getMatch(req, res); if (!m) return;
  if (req.user.id !== m.carrierId) return res.status(403).json({ error: "Only the carrier departs" });
  if (m.escrowStatus !== "held") return res.status(409).json({ error: "Escrow must be funded before departure" });
  m.status = "in_transit";
  m.deliveryOtp = String(randomInt(0, 1000000)).padStart(6, "0");
  save();
  res.json({ match: pub(m, req.user), note: "Delivery OTP generated — visible to the shipper." });
});

/* GPS breadcrumbs (carrier writes; both parties read) */
r.post("/:id/track", requireAuth, (req, res) => {
  const m = getMatch(req, res); if (!m) return;
  if (req.user.id !== m.carrierId) return res.status(403).json({ error: "Only the carrier posts GPS" });
  if (m.status !== "in_transit") return res.status(409).json({ error: "Truck is not in transit" });
  const d = parse(trackSchema, req.body);
  const crumb = { id: uid("C"), matchId: m.id, ...d, at: new Date().toISOString() };
  db.crumbs.push(crumb);
  m.progress = Math.min(100, m.progress + 5);
  save();
  res.status(201).json({ crumb, progress: m.progress });
});

r.get("/:id/track", requireAuth, (req, res) => {
  const m = getMatch(req, res); if (!m) return;
  res.json({ crumbs: db.crumbs.filter((c) => c.matchId === m.id), progress: m.progress });
});

/* proof of delivery: shipper submits the 6-digit OTP → escrow released */
r.post("/:id/confirm", requireAuth, (req, res) => {
  const m = getMatch(req, res); if (!m) return;
  if (req.user.id !== m.shipperId) return res.status(403).json({ error: "Only the shipper confirms delivery" });
  const d = parse(otpSchema, req.body);
  if (m.status !== "in_transit") return res.status(409).json({ error: "Shipment is " + m.status });
  if (d.otp !== m.deliveryOtp) return res.status(400).json({ error: "OTP does not match" });
  m.status = "delivered";
  m.escrowStatus = "released";
  m.progress = 100;
  m.deliveredAt = new Date().toISOString();
  save();
  res.json({ match: pub(m, req.user), released: true });
});

export default r;
