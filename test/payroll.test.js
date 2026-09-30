const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const DB = path.join(ROOT, "payroll.db");
let server;
let cookie = "";

async function request(route, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch("http://127.0.0.1:3101" + route, { ...options, headers });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

test.before(async () => {
  try { fs.rmSync(DB); } catch {}
  server = spawn(process.execPath, ["src/server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "3101", ADMIN_EMAIL: "admin@test.local", ADMIN_PASSWORD: "TestPassword123!", SESSION_SECRET: "test-secret-not-for-production" },
    stdio: "ignore"
  });
  for (let i=0;i<40;i++) {
    try { const r=await fetch("http://127.0.0.1:3101/api/me"); if(r.status) return; } catch {}
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error("Test server did not start");
});

test.after(() => {
  if (server) server.kill();
  try { fs.rmSync(DB); } catch {}
  try { fs.rmSync(DB+"-shm"); } catch {}
  try { fs.rmSync(DB+"-wal"); } catch {}
});

test("protected endpoint rejects anonymous requests", async () => {
  cookie="";
  const r=await request("/api/dashboard");
  assert.equal(r.status,401);
});

test("admin can log in and session is created", async () => {
  const r=await request("/api/login",{method:"POST",body:JSON.stringify({email:"admin@test.local",password:"TestPassword123!"})});
  assert.equal(r.status,200);
  assert.equal(r.body.user.role,"admin");
  assert.ok(cookie);
});

test("worker validation rejects invalid account number", async () => {
  const r=await request("/api/workers",{method:"POST",body:JSON.stringify({first_name:"Test",last_name:"Worker",bank_code:"001",account_number:"123",account_name:"Test Worker",salary:50000})});
  assert.equal(r.status,400);
});

test("admin can create worker and selected payroll batch", async () => {
  let r=await request("/api/workers",{method:"POST",body:JSON.stringify({first_name:"Amina",last_name:"Test",email:"amina@test.local",bank_code:"001",account_number:"1234567890",account_name:"Amina Test",salary:50000})});
  assert.equal(r.status,201);
  const workerId=r.body.id;
  r=await request("/api/batches",{method:"POST",body:JSON.stringify({batch_name:"Test Payroll",payment_date:"2026-09-30",worker_ids:[workerId]})});
  assert.equal(r.status,201);
  const batchId=r.body.id;
  r=await request("/api/batches/"+batchId+"/submit",{method:"POST"});
  assert.equal(r.body.status,"pending_approval");
  r=await request("/api/batches/"+batchId+"/approve",{method:"POST"});
  assert.equal(r.body.status,"approved");
});

test("admin can create officer and officer cannot use admin-only users endpoint", async () => {
  let r=await request("/api/users",{method:"POST",body:JSON.stringify({name:"Payroll Officer",email:"officer@test.local",password:"OfficerPass123!",role:"payroll_officer"})});
  assert.equal(r.status,201);
  cookie="";
  r=await request("/api/login",{method:"POST",body:JSON.stringify({email:"officer@test.local",password:"OfficerPass123!"})});
  assert.equal(r.status,200);
  r=await request("/api/users");
  assert.equal(r.status,403);
});

test("password change requires current password", async () => {
  const r=await request("/api/change-password",{method:"POST",body:JSON.stringify({current_password:"wrong",new_password:"AnotherPass123!"})});
  assert.equal(r.status,400);
});
