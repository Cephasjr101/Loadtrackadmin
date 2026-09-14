import express from "express";
import { config } from "./src/config.js";
import authRoutes from "./src/routes/auth.js";
import truckRoutes from "./src/routes/trucks.js";
import loadRoutes from "./src/routes/loads.js";
import matchRoutes from "./src/routes/matches.js";
import adminRoutes from "./src/routes/admin.js";
import paymentRoutes from "./src/routes/payments.js";

const app = express();
app.disable("x-powered-by");

/* Paystack webhook needs the RAW body for HMAC verification — mount before express.json. */
app.use("/api/payments/webhook", express.raw({ type: "*/*", limit: "100kb" }), paymentRoutes);

app.use(express.json({ limit: "100kb" }));

/* Security headers (same policy as the .htaccess on the static frontend) */
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(self)",
  });
  if (config.corsOrigin) {
    res.set("Access-Control-Allow-Origin", config.corsOrigin);
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Key");
    res.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") return res.status(204).end();
  }
  next();
});

/* Minimal in-memory rate limiting: 300 req/min/IP, 20/min on auth */
const hits = new Map();
setInterval(() => hits.clear(), 60_000).unref();
app.use((req, res, next) => {
  const budget = req.path.startsWith("/api/auth") ? 20 : 300;
  const n = (hits.get(req.ip) || 0) + 1;
  hits.set(req.ip, n);
  if (n > budget) return res.status(429).json({ error: "Too many requests — slow down." });
  next();
});

app.get("/api/health", (req, res) => res.json({ ok: true, service: "loadmatch-backend" }));
app.use("/api/auth", authRoutes);
app.use("/api/trucks", truckRoutes);
app.use("/api/loads", loadRoutes);
app.use("/api/matches", matchRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", paymentRoutes);

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

/* eslint-disable no-unused-vars */
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? "Internal server error" : err.message });
});

app.listen(config.port, () =>
  console.log(`LoadMatch API listening on http://localhost:${config.port}/api`),
);
