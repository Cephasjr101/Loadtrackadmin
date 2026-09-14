import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { db } from "../db.js";

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
    expiresIn: config.tokenTtl,
  });
}

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = db.users.find((u) => u.id === payload.sub);
    if (!user) return res.status(401).json({ error: "Account not found" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: "Forbidden for role " + req.user.role });

export function requireAdmin(req, res, next) {
  if (req.headers["x-admin-key"] !== config.adminKey)
    return res.status(401).json({ error: "Invalid admin key" });
  next();
}
