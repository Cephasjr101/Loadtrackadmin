/* Seed demo data matching the frontend demo — run: npm run seed */
import { db, save, reset } from "../src/db.js";
import bcrypt from "bcryptjs";

reset();

const hash = bcrypt.hashSync("password123", 10);
const carrier = {
  id: "U_carrier1", email: "carrier@demo.gh", name: "Adom Haulage Ltd",
  phone: "+233 24 000 0001", role: "carrier", passwordHash: hash,
  verified: true, createdAt: new Date().toISOString(),
};
const shipper = {
  id: "U_shipper1", email: "shipper@demo.gh", name: "Asante Furnishings",
  phone: "+233 24 000 0002", role: "shipper", passwordHash: hash,
  verified: true, createdAt: new Date().toISOString(),
};
db.users.push(carrier, shipper);

db.trucks.push({
  id: "T1", ownerId: carrier.id, owner: carrier.name, plateNo: "GR 4521-22",
  from: "Kumasi", to: "Accra", truckType: "Box truck",
  capacityKg: 8000, volumeM3: 28, ratePerKm: 4.2,
  availableFrom: "2026-09-12", availableTo: "2026-09-20",
  verified: true, createdAt: new Date().toISOString(),
});
db.loads.push({
  id: "L1", shipperId: shipper.id, company: shipper.name,
  cargo: "Furniture (40 items)", from: "Accra", to: "Kumasi",
  weightKg: 4500, volumeM3: 18, budgetGhs: 1300,
  pickupDate: "2026-09-15", deliveryDate: "2026-09-15",
  createdAt: new Date().toISOString(),
});
save();
console.log("Seeded: carrier@demo.gh / shipper@demo.gh (password: password123)");
