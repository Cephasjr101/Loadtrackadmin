import { Router } from "express";
import { db, uid, save } from "../db.js";
import { requireAuth, requireRole } from "../lib/auth.js";
import { truckSchema, parse } from "../lib/validators.js";

const r = Router();

r.get("/", (req, res) => {
  const { from, to } = req.query;
  let out = db.trucks;
  if (from) out = out.filter((t) => t.from === from);
  if (to) out = out.filter((t) => t.to === to);
  res.json({ trucks: out });
});

r.post("/", requireAuth, requireRole("carrier"), (req, res) => {
  const d = parse(truckSchema, req.body);
  const truck = {
    id: uid("T"), ownerId: req.user.id, owner: req.user.name,
    verified: false, createdAt: new Date().toISOString(), ...d,
  };
  db.trucks.push(truck); save();
  res.status(201).json({ truck });
});

r.get("/:id", (req, res) => {
  const t = db.trucks.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: "Truck not found" });
  res.json({ truck: t });
});

r.patch("/:id", requireAuth, requireRole("carrier"), (req, res) => {
  const t = db.trucks.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: "Truck not found" });
  if (t.ownerId !== req.user.id) return res.status(403).json({ error: "Not your truck" });
  const d = parse(truckSchema.partial(), { ...t, ...req.body });
  Object.assign(t, d); save();
  res.json({ truck: t });
});

r.delete("/:id", requireAuth, requireRole("carrier"), (req, res) => {
  const i = db.trucks.findIndex((x) => x.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: "Truck not found" });
  if (db.trucks[i].ownerId !== req.user.id) return res.status(403).json({ error: "Not your truck" });
  db.trucks.splice(i, 1); save();
  res.status(204).end();
});

export default r;
