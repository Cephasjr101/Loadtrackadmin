import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, uid, save } from "../db.js";
import { signToken, requireAuth } from "../lib/auth.js";
import { registerSchema, loginSchema, parse } from "../lib/validators.js";

const r = Router();

r.post("/register", (req, res) => {
  const d = parse(registerSchema, req.body);
  if (db.users.some((u) => u.email === d.email))
    return res.status(409).json({ error: "Email already registered" });
  const user = {
    id: uid("U"), email: d.email, name: d.name, phone: d.phone, role: d.role,
    passwordHash: bcrypt.hashSync(d.password, 10),
    verified: false, createdAt: new Date().toISOString(),
  };
  db.users.push(user); save();
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

r.post("/login", (req, res) => {
  const d = parse(loginSchema, req.body);
  const user = db.users.find((u) => u.email === d.email);
  if (!user || !bcrypt.compareSync(d.password, user.passwordHash))
    return res.status(401).json({ error: "Invalid email or password" });
  res.json({ token: signToken(user), user: publicUser(user) });
});

r.get("/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role, verified: u.verified };
}

export default r;
