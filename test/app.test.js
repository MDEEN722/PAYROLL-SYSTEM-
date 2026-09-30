const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.ADMIN_EMAIL = "admin@example.com";
process.env.ADMIN_PASSWORD = "ChangeMe123!";
process.env.SESSION_SECRET = "test-session-secret-not-for-production";

const app = require("../src/server");
const db = require("../src/db");

let server;
let baseUrl;

async function request(path, options = {}, cookie = "") {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(baseUrl + path, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  return { res, body, cookie: res.headers.get("set-cookie")?.split(";")[0] || cookie };
}

async function login(email = "admin@example.com", password = "ChangeMe123!") {
  const r = await request("/api/login", { method: "POST", body: JSON.stringify({ email, password }) });
  assert.equal(r.res.status, 200);
  return r.cookie;
}

test.before(() => {
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

test("protected routes require authentication", async () => {
  const r = await request("/api/dashboard");
  assert.equal(r.res.status, 401);
});

test("admin can login and read dashboard", async () => {
  const cookie = await login();
  const r = await request("/api/dashboard", {}, cookie);
  assert.equal(r.res.status, 200);
  assert.ok("workers" in r.body);
});

test("invalid worker data is rejected", async () => {
  const cookie = await login();
  const r = await request("/api/workers", {
    method: "POST",
    body: JSON.stringify({ first_name: "Test", last_name: "Worker", bank_code: "001", account_number: "12", account_name: "Test", salary: 1000 })
  }, cookie);
  assert.equal(r.res.status, 400);
});

test("payroll officer cannot access admin user management", async () => {
  const email = `officer-${Date.now()}@example.com`;
  const adminCookie = await login();
  const created = await request("/api/users", {
    method: "POST",
    body: JSON.stringify({ name: "Payroll Officer", email, password: "OfficerPass123!", role: "payroll_officer" })
  }, adminCookie);
  assert.equal(created.res.status, 201);
  const officerCookie = await login(email, "OfficerPass123!");
  const users = await request("/api/users", {}, officerCookie);
  assert.equal(users.res.status, 403);
});

test("batch follows draft to pending approval to approved", async () => {
  const cookie = await login();
  const account = String(Date.now()).slice(-10).padStart(10, "7");
  const worker = await request("/api/workers", {
    method: "POST",
    body: JSON.stringify({ first_name:"Batch", last_name:"Tester", bank_code:"001", account_number:account, account_name:"Batch Tester", salary:25000 })
  }, cookie);
  assert.equal(worker.res.status, 201);
  const batch = await request("/api/batches", {
    method:"POST",
    body:JSON.stringify({ batch_name:"Automated Test Batch", payment_date:"2026-09-30", worker_ids:[worker.body.id] })
  }, cookie);
  assert.equal(batch.res.status, 201);
  let r = await request(`/api/batches/${batch.body.id}/submit`, { method:"POST" }, cookie);
  assert.equal(r.body.status, "pending_approval");
  r = await request(`/api/batches/${batch.body.id}/approve`, { method:"POST" }, cookie);
  assert.equal(r.body.status, "approved");
});

test("admin cannot deactivate own account", async () => {
  const cookie = await login();
  const me = await request("/api/me", {}, cookie);
  const r = await request(`/api/users/${me.body.user.id}/status`, {
    method:"PATCH", body:JSON.stringify({status:"inactive"})
  }, cookie);
  assert.equal(r.res.status, 400);
});
