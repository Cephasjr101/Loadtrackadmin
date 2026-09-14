/* Server-side Paystack client. The SECRET key never leaves this process. */
import crypto from "node:crypto";
import { config } from "../config.js";

async function ps(path, opts = {}) {
  const res = await fetch(config.paystack.base + path, {
    ...opts,
    headers: {
      Authorization: "Bearer " + config.paystack.secretKey,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.status) {
    throw Object.assign(new Error("Paystack error: " + (data?.message || res.status)), { status: 502 });
  }
  return data.data;
}

/* Paystack amounts are in the subunit: GHS → pesewas (×100). */
export const toPesewas = (ghs) => Math.round(ghs * 100);

export function newReference(matchId) {
  return "LM-" + matchId + "-" + crypto.randomBytes(6).toString("hex").toUpperCase();
}

export async function initializeTransaction({ email, amountGhs, reference, metadata, callbackUrl }) {
  return ps("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email,
      amount: toPesewas(amountGhs),
      reference,
      currency: "GHS",
      callback_url: callbackUrl || undefined,
      metadata,
    }),
  });
}

export async function verifyTransaction(reference) {
  return ps("/transaction/verify/" + encodeURIComponent(reference));
}

/* Webhook authenticity: x-paystack-signature = HMAC-SHA512(rawBody, secretKey). */
export function validWebhookSignature(rawBody, signature) {
  if (!signature || !config.paystack.secretKey) return false;
  const expected = crypto
    .createHmac("sha512", config.paystack.secretKey)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
