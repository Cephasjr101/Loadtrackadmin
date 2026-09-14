import { Router } from "express";
import { db, save } from "../db.js";
import { requireAdmin } from "../lib/auth.js";

const r = Router();
r.use(requireAdmin);

/* Verify a carrier's truck (24h review workflow) */
r.post("/trucks/:id/verify", (req, res) => {
  const t = db.trucks.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: "Truck not found" });
  t.verified = true;
  t.verifiedAt = new Date().toISOString();
  save();
  res.json({ truck: t });
});

r.get("/trucks/pending", (req, res) => {
  res.json({ trucks: db.trucks.filter((t) => !t.verified) });
});

r.get("/stats", (req, res) => {
  const revenue = db.matches
    .filter((m) => m.escrowStatus === "released")
    .reduce((s, m) => s + Math.round((m.priceGhs * m.commissionPct) / 100), 0);
  res.json({
    trucks: db.trucks.length,
    pendingVerification: db.trucks.filter((t) => !t.verified).length,
    loads: db.loads.length,
    matches: db.matches.length,
    inTransit: db.matches.filter((m) => m.status === "in_transit").length,
    delivered: db.matches.filter((m) => m.status === "delivered").length,
    commissionEarnedGhs: revenue,
  });
});

export default r;
