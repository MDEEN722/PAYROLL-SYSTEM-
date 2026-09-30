require("dotenv").config();

const express = require("express");
const session = require("express-session");
const path = require("path");
const bcrypt = require("bcryptjs");
const db = require("./db");
const { payWorker } = require("./services/paymentProvider");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAX_BATCH_WORKERS = Number(process.env.MAX_BATCH_WORKERS || 100);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "development-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax" }
}));
app.use(express.static(path.join(__dirname, "..", "public")));

function auth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Authentication required" });
  next();
}

function audit(userId, action, details = "") {
  db.prepare("INSERT INTO audit_logs (user_id, action, details) VALUES (?,?,?)")
    .run(userId, action, details);
}

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  audit(user.id, "LOGIN", "User logged in");
  res.json({ user: req.session.user });
});

app.post("/api/logout", auth, (req, res) => {
  const id = req.session.user.id;
  audit(id, "LOGOUT", "User logged out");
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => res.json({ user: req.session.user || null }));

app.get("/api/dashboard", auth, (req, res) => {
  const workers = db.prepare("SELECT COUNT(*) count FROM workers WHERE status='active'").get().count;
  const batches = db.prepare("SELECT COUNT(*) count FROM payment_batches").get().count;
  const paid = db.prepare("SELECT COALESCE(SUM(amount),0) total FROM payments WHERE status='success'").get().total;
  const pending = db.prepare("SELECT COUNT(*) count FROM payments WHERE status IN ('pending','processing')").get().count;
  res.json({ workers, batches, paid, pending });
});

app.get("/api/workers", auth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, first_name, last_name, email, phone, bank_code,
           substr(account_number,1,3) || '****' || substr(account_number,-2) account_number,
           account_name, salary, status, created_at
    FROM workers ORDER BY id DESC
  `).all();
  res.json(rows);
});

function cleanWorker(body) {
  const first_name = String(body.first_name || "").trim();
  const last_name = String(body.last_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim();
  const bank_code = String(body.bank_code || "").trim();
  const account_number = String(body.account_number || "").replace(/\s+/g, "");
  const account_name = String(body.account_name || "").trim();
  const salary = Number(body.salary);
  if (!first_name || !last_name || !bank_code || !account_number || !account_name || !Number.isFinite(salary) || salary <= 0) {
    return { error: "Please provide all required worker details." };
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Please enter a valid email address." };
  if (!/^\d{10}$/.test(account_number)) return { error: "Account number must contain exactly 10 digits." };
  if (phone && !/^\+?[0-9]{10,15}$/.test(phone.replace(/[\s-]/g, ""))) return { error: "Please enter a valid phone number." };
  return { first_name, last_name, email: email || null, phone: phone || null, bank_code, account_number, account_name, salary };
}

app.post("/api/workers", auth, (req, res) => {
  const worker = cleanWorker(req.body);
  if (worker.error) return res.status(400).json({ error: worker.error });
  const duplicate = db.prepare("SELECT id FROM workers WHERE account_number=?").get(worker.account_number);
  if (duplicate) return res.status(409).json({ error: "A worker with this account number already exists." });
  const result = db.prepare(`
    INSERT INTO workers (first_name,last_name,email,phone,bank_code,account_number,account_name,salary)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(worker.first_name,worker.last_name,worker.email,worker.phone,worker.bank_code,worker.account_number,worker.account_name,worker.salary);
  audit(req.session.user.id, "CREATE_WORKER", `Worker ID ${result.lastInsertRowid}`);
  res.status(201).json({ id: result.lastInsertRowid });
});

app.put("/api/workers/:id", auth, (req, res) => {
  const existing = db.prepare("SELECT id FROM workers WHERE id=?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Worker not found." });
  const worker = cleanWorker(req.body);
  if (worker.error) return res.status(400).json({ error: worker.error });
  const duplicate = db.prepare("SELECT id FROM workers WHERE account_number=? AND id!=?").get(worker.account_number, req.params.id);
  if (duplicate) return res.status(409).json({ error: "Another worker already uses this account number." });
  db.prepare(`UPDATE workers SET first_name=?,last_name=?,email=?,phone=?,bank_code=?,account_number=?,account_name=?,salary=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(worker.first_name,worker.last_name,worker.email,worker.phone,worker.bank_code,worker.account_number,worker.account_name,worker.salary,req.params.id);
  audit(req.session.user.id, "UPDATE_WORKER", `Worker ID ${req.params.id}`);
  res.json({ ok: true });
});

app.patch("/api/workers/:id/deactivate", auth, (req, res) => {
  db.prepare("UPDATE workers SET status='inactive', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
  audit(req.session.user.id, "DEACTIVATE_WORKER", `Worker ID ${req.params.id}`);
  res.json({ ok: true });
});

app.post("/api/batches", auth, (req, res) => {
  const batch_name = String(req.body.batch_name || "").trim();
  const payment_date = String(req.body.payment_date || "").trim();
  if (!batch_name) return res.status(400).json({ error: "Batch name is required." });
  if (payment_date && !/^\d{4}-\d{2}-\d{2}$/.test(payment_date)) return res.status(400).json({ error: "Payment date must be YYYY-MM-DD." });
  const workers = db.prepare("SELECT id, salary FROM workers WHERE status='active'").all();
  if (!workers.length) return res.status(400).json({ error: "No active workers available." });
  if (workers.length > MAX_BATCH_WORKERS) {
    return res.status(400).json({ error: `A batch can contain at most ${MAX_BATCH_WORKERS} workers.` });
  }

  const create = db.transaction(() => {
    const total = workers.reduce((sum, w) => sum + Number(w.salary), 0);
    const batch = db.prepare(`
      INSERT INTO payment_batches (batch_name,payment_date,total_workers,total_amount,status,created_by)
      VALUES (?,?,?,?,?,?)
    `).run(batch_name || "Payroll Batch", payment_date || new Date().toISOString().slice(0,10), workers.length, total, "draft", req.session.user.id);

    const insert = db.prepare("INSERT INTO payments (batch_id,worker_id,amount,status) VALUES (?,?,?,'pending')");
    for (const worker of workers) insert.run(batch.lastInsertRowid, worker.id, worker.salary);
    return batch.lastInsertRowid;
  });

  const id = create();
  audit(req.session.user.id, "CREATE_BATCH", `Batch ID ${id}`);
  res.status(201).json({ id });
});

app.get("/api/batches", auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM payment_batches ORDER BY id DESC").all());
});

app.get("/api/batches/:id/payments", auth, (req, res) => {
  res.json(db.prepare(`
    SELECT p.*, w.first_name, w.last_name, w.account_name
    FROM payments p JOIN workers w ON w.id=p.worker_id
    WHERE p.batch_id=? ORDER BY p.id
  `).all(req.params.id));
});

app.post("/api/payment-batches/:id/pay", auth, async (req, res) => {
  const batch = db.prepare("SELECT * FROM payment_batches WHERE id=?").get(req.params.id);
  if (!batch) return res.status(404).json({ error: "Batch not found" });
  if (["completed","processing"].includes(batch.status)) {
    return res.status(400).json({ error: "This batch cannot be paid again." });
  }

  db.prepare("UPDATE payment_batches SET status='processing' WHERE id=?").run(batch.id);
  const payments = db.prepare("SELECT * FROM payments WHERE batch_id=? AND status!='success'").all(batch.id);

  for (const payment of payments) {
    db.prepare("UPDATE payments SET status='processing' WHERE id=?").run(payment.id);
    const worker = db.prepare("SELECT * FROM workers WHERE id=?").get(payment.worker_id);
    try {
      const result = await payWorker(worker, payment.amount);
      db.prepare(`
        UPDATE payments SET status='success', provider_reference=?, paid_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(result.reference, payment.id);
    } catch (error) {
      db.prepare("UPDATE payments SET status='failed', failure_reason=? WHERE id=?")
        .run(error.message, payment.id);
    }
  }

  const failed = db.prepare("SELECT COUNT(*) count FROM payments WHERE batch_id=? AND status='failed'").get(batch.id).count;
  const remaining = db.prepare("SELECT COUNT(*) count FROM payments WHERE batch_id=? AND status!='success'").get(batch.id).count;
  const status = failed ? (remaining ? "partially_failed" : "failed") : "completed";
  db.prepare("UPDATE payment_batches SET status=?, completed_at=CURRENT_TIMESTAMP WHERE id=?").run(status, batch.id);
  audit(req.session.user.id, "PAY_BATCH", `Batch ID ${batch.id}`);
  res.json({ ok: true, status });
});

app.post("/api/webhooks/payment", (req, res) => {
  const { provider_reference, status, failure_reason } = req.body;
  if (!provider_reference) return res.status(400).json({ error: "provider_reference is required" });
  const payment = db.prepare("SELECT id FROM payments WHERE provider_reference=?").get(provider_reference);
  if (!payment) return res.status(404).json({ error: "Payment reference not found" });
  db.prepare("UPDATE payments SET status=?, failure_reason=? WHERE id=?")
    .run(status || "success", failure_reason || null, payment.id);
  res.json({ received: true });
});

app.get("/api/audit-logs", auth, (req, res) => {
  res.json(db.prepare(`
    SELECT a.*, u.name FROM audit_logs a
    LEFT JOIN users u ON u.id=a.user_id
    ORDER BY a.id DESC LIMIT 100
  `).all());
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));

app.listen(PORT, () => console.log(`Payroll System running on http://localhost:${PORT}`));
