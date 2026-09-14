/* Ported from the frontend data.js — identical scoring so both sides agree. */
const KM = {
  "Accra-Kumasi": 270, "Accra-Tema": 30, "Accra-Takoradi": 220, "Accra-Tamale": 620,
  "Accra-Ho": 160, "Accra-Cape Coast": 150, "Accra-Sunyani": 430,
  "Kumasi-Tema": 300, "Kumasi-Takoradi": 210, "Kumasi-Tamale": 390, "Kumasi-Ho": 310,
  "Kumasi-Cape Coast": 200, "Kumasi-Sunyani": 120,
  "Tema-Takoradi": 240, "Tema-Tamale": 650, "Tema-Ho": 190, "Tema-Cape Coast": 170, "Tema-Sunyani": 460,
  "Takoradi-Tamale": 590, "Takoradi-Ho": 350, "Takoradi-Cape Coast": 110, "Takoradi-Sunyani": 240,
  "Tamale-Ho": 470, "Tamale-Cape Coast": 560, "Tamale-Sunyani": 330,
  "Ho-Cape Coast": 220, "Ho-Sunyani": 380, "Cape Coast-Sunyani": 190,
};
export const CITIES = [
  "Accra", "Kumasi", "Tema", "Takoradi", "Tamale", "Ho", "Cape Coast", "Sunyani",
];
export function dist(a, b) {
  if (a === b) return 0;
  return KM[a + "-" + b] || KM[b + "-" + a] || 250;
}

const overlap = (a1, a2, b1, b2) => new Date(a1) <= new Date(b2) && new Date(b1) <= new Date(a2);

export function scoreMatch(truck, load) {
  const reasons = [];
  let score = 0;
  const reverse = truck.from === load.to && truck.to === load.from;
  const sameDir = truck.from === load.from && truck.to === load.to;
  if (reverse) { score += 100; reasons.push("Exact reverse route (+100)"); }
  else if (sameDir) { score += 60; reasons.push("Same direction (+60)"); }
  else return null;

  if (truck.capacityKg >= load.weightKg) { score += 15; reasons.push("Capacity fits (+15)"); } else return null;
  if (truck.volumeM3 >= load.volumeM3) { score += 5; reasons.push("Volume fits (+5)"); } else return null;
  if (overlap(truck.availableFrom, truck.availableTo, load.pickupDate, load.deliveryDate)) {
    score += 10; reasons.push("Dates overlap (+10)");
  } else return null;

  const est = Math.round(dist(load.from, load.to) * truck.ratePerKm);
  if (load.budgetGhs >= est) { score += 10; reasons.push("Budget covers estimate (+10)"); }
  else { score -= 10; reasons.push("Budget below estimate (−10)"); }
  if (truck.verified) { score += 5; reasons.push("Verified carrier (+5)"); }

  return { score, estGhs: est, reasons, reverse };
}

export function findMatches(trucks, loads) {
  const out = [];
  for (const t of trucks) for (const l of loads) {
    const m = scoreMatch(t, l);
    if (m) out.push({ truckId: t.id, loadId: l.id, ...m });
  }
  return out.sort((a, b) => b.score - a.score);
}
