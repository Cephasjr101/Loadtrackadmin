import { z } from "zod";
import { CITIES } from "./matching.js";

const phone = /^(\+233|0)\s?\d{2}\s?\d{3}\s?\d{4}$/;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const city = z.enum(CITIES);

export const registerSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8, "Minimum 8 characters"),
  name: z.string().min(2).max(120),
  phone: z.string().regex(phone, "Enter a valid Ghana phone (+233… or 0…)"),
  role: z.enum(["carrier", "shipper"]),
});

export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

export const truckSchema = z.object({
  plateNo: z.string().min(3).max(20),
  from: city,
  to: city,
  truckType: z.enum(["Box truck", "Flatbed", "Tautliner", "Refrigerated", "Tipper"]),
  capacityKg: z.number().positive(),
  volumeM3: z.number().positive(),
  ratePerKm: z.number().positive(),
  availableFrom: date,
  availableTo: date,
}).refine((d) => d.from !== d.to, { message: "Origin and destination must differ", path: ["to"] })
  .refine((d) => new Date(d.availableTo) >= new Date(d.availableFrom), {
    message: "availableTo must be on/after availableFrom", path: ["availableTo"],
  });

export const loadSchema = z.object({
  cargo: z.string().min(3).max(200),
  from: city,
  to: city,
  weightKg: z.number().positive(),
  volumeM3: z.number().positive(),
  budgetGhs: z.number().positive(),
  pickupDate: date,
  deliveryDate: date,
}).refine((d) => d.from !== d.to, { message: "Origin and destination must differ", path: ["to"] })
  .refine((d) => new Date(d.deliveryDate) >= new Date(d.pickupDate), {
    message: "deliveryDate must be on/after pickupDate", path: ["deliveryDate"],
  });

export const createMatchSchema = z.object({
  truckId: z.string(),
  loadId: z.string(),
  priceGhs: z.number().positive().optional(),
  commissionPct: z.number().optional(),
});

export const signSchema = z.object({
  signerName: z.string().min(3),
  accept: z.literal(true),
});

export const trackSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  note: z.string().max(200).optional(),
});

export const otpSchema = z.object({ otp: z.string().regex(/^\d{6}$/) });

export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const err = new Error(r.error.issues.map((i) => i.path.join(".") + ": " + i.message).join("; "));
    err.status = 400;
    throw err;
  }
  return r.data;
}
