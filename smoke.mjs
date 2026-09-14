/* End-to-end smoke test — run: npm run smoke (server must be running) */
const BASE = process.env.BASE_URL || "http://localhost:4000";
let failures = 0;
const ok = (cond, label) => {
  console.log((cond ? "PASS" : "FAIL") + "  " + label);
  if (!cond) failures++;
};

async function api(method, path, body, token, adminKey) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(adminKey ? { "X-Admin-Key": adminKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
}

const stamp = Date.now().toString(36);
const carrierAuth = await api("POST", "/api/auth/register", {
  email: `car_${stamp}@test.gh`, password: "password123",
  name: "Smoke Carrier", phone: "+233 24 111 2233", role: "carrier",
});
ok(carrierAuth.status === 201, "register carrier");
const shipperAuth = await api("POST", "/api/auth/register", {
  email: `ship_${stamp}@test.gh`, password: "password123",
  name: "Smoke Shipper", phone: "+233 24 444 5566", role: "shipper",
});
ok(shipperAuth.status === 201, "register shipper");
const ct = carrierAuth.data.token, st = shipperAuth.data.token;

const bad = await api("POST", "/api/auth/login", { email: `car_${stamp}@test.gh`, password: "wrong" });
ok(bad.status === 401, "rejects wrong password");

const truck = await api("POST", "/api/trucks", {
  plateNo: "GR 9999-99", from: "Kumasi", to: "Accra", truckType: "Box truck",
  capacityKg: 8000, volumeM3: 28, ratePerKm: 4.2,
  availableFrom: "2026-09-12", availableTo: "2026-09-20",
}, ct);
ok(truck.status === 201, "carrier posts truck");

const wrongRole = await api("POST", "/api/trucks", truck.data?.truck, st);
ok(wrongRole.status === 403, "shipper cannot post truck");

const load = await api("POST", "/api/loads", {
  cargo: "300 bags of cocoa", from: "Accra", to: "Kumasi",
  weightKg: 4500, volumeM3: 18, budgetGhs: 1300,
  pickupDate: "2026-09-15", deliveryDate: "2026-09-15",
}, st);
ok(load.status === 201, "shipper posts load");

const run = await api("POST", "/api/matches/run", {}, ct);
ok(run.status === 200 && run.data.matches.length >= 1, "matching engine finds pairs");

const made = await api("POST", "/api/matches", {
  truckId: truck.data.truck.id, loadId: load.data.load.id,
}, ct);
ok(made.status === 201, "create match");
const mid = made.data.match.id;

const s1 = await api("POST", `/api/matches/${mid}/sign`, { signerName: "Smoke Carrier", accept: true }, ct);
ok(s1.status === 200 && s1.data.match.status === "proposed", "carrier signs");
const s2 = await api("POST", `/api/matches/${mid}/sign`, { signerName: "Smoke Shipper", accept: true }, st);
ok(s2.status === 200 && s2.data.match.status === "contract_signed", "both signatures → contract_signed");

const fundByCarrier = await api("POST", `/api/matches/${mid}/fund`, {}, ct);
ok(fundByCarrier.status === 403, "carrier cannot fund escrow");
const fund = await api("POST", `/api/matches/${mid}/fund`, { simulate: true }, st);
ok(fund.status === 200 && fund.data.match.escrowStatus === "held", "shipper funds escrow");

const dep = await api("POST", `/api/matches/${mid}/depart`, {}, ct);
ok(dep.status === 200 && dep.data.match.status === "in_transit", "carrier departs, OTP generated");

const detail = await api("GET", `/api/matches/${mid}`, null, st);
const otp = detail.data.match.deliveryOtp;
ok(/^\d{6}$/.test(otp || ""), "shipper can read 6-digit OTP");
const carrierDetail = await api("GET", `/api/matches/${mid}`, null, ct);
ok(carrierDetail.data.match.deliveryOtp === undefined, "carrier cannot read OTP");

const crumb = await api("POST", `/api/matches/${mid}/track`, { lat: 6.7, lng: -1.6, note: "Nkawkaw" }, ct);
ok(crumb.status === 201, "carrier posts GPS crumb");
const trackByShipper = await api("POST", `/api/matches/${mid}/track`, { lat: 6.7, lng: -1.6 }, st);
ok(trackByShipper.status === 403, "shipper cannot post GPS");

const wrongOtp = await api("POST", `/api/matches/${mid}/confirm`, { otp: "000000" }, st);
ok(wrongOtp.status === 400, "rejects wrong OTP");
const confirm = await api("POST", `/api/matches/${mid}/confirm`, { otp }, st);
ok(confirm.status === 200 && confirm.data.match.escrowStatus === "released", "correct OTP releases escrow");

const esc = await api("GET", `/api/matches/${mid}`, null, st);
ok(esc.data.escrow.commissionGhs > 0 && esc.data.escrow.carrierPayoutGhs < esc.data.match.priceGhs,
   "commission deducted from payout");

const stranger = await api("GET", `/api/matches/${mid}`, null, null);
ok(stranger.status === 401, "unauthenticated access rejected");

const initNoKeys = await api("POST", `/api/matches/${mid}/pay/initialize`, {}, st);
ok(initNoKeys.status === 409, "pay/initialize rejected cleanly without Paystack keys");

const pubCfg = await api("GET", "/api/payments/config/public");
ok(pubCfg.status === 200 && pubCfg.data.commission.min === 3, "public config exposes commission band, no secrets");

const stats = await api("GET", "/api/admin/stats", null, null, process.env.ADMIN_KEY || "dev-admin-key");
ok(stats.status === 200 && stats.data.delivered >= 1, "admin stats show delivered shipment");

console.log(failures === 0 ? "ALL SMOKE TESTS PASSED" : failures + " FAILURE(S)");
process.exit(failures === 0 ? 0 : 1);
