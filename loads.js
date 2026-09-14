import { Router } from "express";
import { db, uid, save } from "../db.js";
import { requireAuth, requireRole } from "../lib/auth.js";
import { loadSchema, parse } from "../lib/validators.js";

const r = Router();

r.get("/", (req, res) => {
  const { from, to } = req.query;
  let out = db.loads;
  if (from) out = out.filter((l) => l.from === from);
  if (to) out = out.filter((l) => l.to === to);
  res.json({ loads: out });
});

r.post("/", requireAuth, requireRole("shipper"), (req, res) => {
  const d = parse(loadSchema, req.body);
  const load = {
    id: uid("L"), shipperId: req.user.id, company: req.user.name,
    createdAt: new Date().toISOString(), ...d,
  };
  db.loads.push(load); save();
  res.status(201).json({ load });
});

r.get("/:id", (req, res) => {
  const l = db.loads.find((x) => x.id === req.params.id);
  if (!l) return res.status(404).json({ error: "Load not found" });
  res.json({ load: l });
});

r.delete("/:id", requireAuth, requireRole("shipper"), (req, res) => {
  const i = db.loads.findIndex((x) => x.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: "Load not found" });
  if (db.loads[i].shipperId !== req.user.id) return res.status(403).json({ error: "Not your load" });
  db.loads.splice(i, 1); save();
  res.status(204).end();
});

export default r;
