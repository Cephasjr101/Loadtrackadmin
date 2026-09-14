/* Paystack webhook + verification endpoints.
 * The webhook MUST receive the RAW body (mounted with express.raw in server.js)
 * because the HMAC signature covers the unparsed payload. */
import { Router } from "express";
import { db, save } from "../db.js";
import { config, paystackEnabled } from "../config.js";
import { requireAuth } from "../lib/auth.js";
import { verifyTransaction, validWebhookSignature } from "../lib/paystack.js";

const r = Router();

/* Public runtime config for the frontend (public key + commission band only — never secrets). */
r.get("/config/public", (req, res) => {
  res.json({
    paystackPublicKey: config.paystack.publicKey,
    paystackEnabled: paystackEnabled(),
    callbackUrl: config.paystack.callbackUrl,
    commission: config.commission,
  });
});

function settleMatch(match, reference, amountPesewas) {
  if (match.escrowStatus === "held") return { already: true };
  match.escrowStatus = "held";
  match.status = "ready_for_pickup";
  match.payment = {
    provider: "paystack",
    reference,
    amountGhs: amountPesewas / 100,
    paidAt: new Date().toISOString(),
  };
  save();
  return { already: false };
}

/* POST /api/payments/webhook — called by Paystack (no auth; signature-checked). */
r.post("/webhook", (req, res) => {
  const raw = req.body?.toString("utf8") || "";
  const sig = req.headers["x-paystack-signature"];
  if (!validWebhookSignature(raw, sig)) return res.status(401).end();

  let event;
  try { event = JSON.parse(raw); } catch { return res.status(400).end(); }
  if (event.event !== "charge.success") return res.status(200).end();

  const ref = event.data?.reference;
  const match = db.matches.find((m) => m.payment?.reference === ref || m.pendingReference === ref);
  if (!match) return res.status(200).end();

  /* Never trust the event payload alone — confirm server-to-server. */
  verifyTransaction(ref)
    .then((tx) => {
      if (tx.status === "success") {
        settleMatch(match, ref, tx.amount);
        match.pendingReference = null;
        save();
      }
    })
    .catch(() => {});
  res.status(200).end();
});

/* GET /api/payments/verify/:reference — browser callback fallback (token-authed). */
r.get("/verify/:reference", requireAuth, async (req, res) => {
  if (!paystackEnabled()) return res.status(409).json({ error: "Paystack not configured (simulation mode)" });
  const match = db.matches.find((m) => m.payment?.reference === req.params.reference
    || m.pendingReference === req.params.reference);
  if (!match) return res.status(404).json({ error: "Payment not found" });
  if (req.user.id !== match.shipperId && req.user.id !== match.carrierId)
    return res.status(403).json({ error: "Not a party to this match" });
  try {
    const tx = await verifyTransaction(req.params.reference);
    if (tx.status === "success") settleMatch(match, req.params.reference, tx.amount);
    res.json({ status: tx.status, matchStatus: match.status, escrowStatus: match.escrowStatus });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

export default r;
