require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const { query, initDb } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

function normalizeUid(uid) {
  return String(uid || "")
    .toUpperCase()
    .replace(/[^A-F0-9]/g, "");
}

async function getSettings() {
  const { rows } = await query("SELECT * FROM settings WHERE id = 1");
  return rows[0] || { default_charge_amount: 5, currency: "USD", min_balance: 0 };
}

async function findUserByUid(rfidUid) {
  const { rows } = await query("SELECT * FROM users WHERE rfid_uid = $1 LIMIT 1", [
    normalizeUid(rfidUid),
  ]);
  return rows[0] || null;
}

async function validateDevice(deviceKey) {
  const { rows } = await query(
    "SELECT * FROM devices WHERE api_key = $1 AND active = true LIMIT 1",
    [deviceKey]
  );
  if (!rows[0]) return null;
  await query("UPDATE devices SET last_seen = NOW() WHERE id = $1", [rows[0].id]);
  return rows[0];
}

async function authDevice(req, res, next) {
  const deviceKey =
    req.headers["x-device-key"] || req.body?.deviceKey || req.query?.deviceKey;
  if (!deviceKey) {
    return res.status(401).json({ success: false, error: "device_key_required" });
  }
  try {
    const device = await validateDevice(deviceKey);
    if (!device) {
      return res.status(403).json({ success: false, error: "invalid_device_key" });
    }
    req.device = device;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "device_validation_failed" });
  }
}

// ── Salud y despertador Render ──

app.get("/health", (_req, res) => {
  res.json({
    success: true,
    service: "sistema-lavado-rfid",
    platform: "render",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
  });
});

/** Despertador: Render free duerme ~15 min sin tráfico. Llama esto antes de check/charge. */
app.get("/v1/status", (_req, res) => {
  res.json({ success: true, status: "ok" });
});

// ── API ESP32 ──

app.post("/v1/check", authDevice, async (req, res) => {
  const uid = normalizeUid(req.body?.uid);
  if (!uid) return res.status(400).json({ success: false, error: "uid_required" });

  try {
    const user = await findUserByUid(uid);
    const settings = await getSettings();
    if (!user) {
      return res.json({ success: true, found: false, uid, message: "Tarjeta no registrada" });
    }
    await query("UPDATE users SET last_used_at = NOW() WHERE id = $1", [user.id]);
    const isActive = user.status === "active";
    res.json({
      success: true,
      found: true,
      uid: user.rfid_uid,
      userId: user.id,
      name: user.name,
      balance: Number(user.balance),
      status: user.status,
      active: isActive,
      canUse: isActive && Number(user.balance) >= Number(settings.min_balance),
      currency: settings.currency,
      defaultChargeAmount: Number(settings.default_charge_amount),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "internal_error" });
  }
});

app.post("/v1/charge", authDevice, async (req, res) => {
  const uid = normalizeUid(req.body?.uid);
  const amount = Number(req.body?.amount);
  const description = req.body?.description || "Cobro lavado";
  if (!uid) return res.status(400).json({ success: false, error: "uid_required" });
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ success: false, error: "invalid_amount" });
  }

  const client = await require("./db").pool.connect();
  try {
    await client.query("BEGIN");
    const userRes = await client.query("SELECT * FROM users WHERE rfid_uid = $1 FOR UPDATE", [
      uid,
    ]);
    const user = userRes.rows[0];
    if (!user) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "user_not_found" });
    }
    if (user.status !== "active") {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, error: "user_inactive" });
    }
    if (Number(user.balance) < amount) {
      await client.query("ROLLBACK");
      return res.status(402).json({ success: false, error: "insufficient_balance" });
    }

    const balanceBefore = Number(user.balance);
    const balanceAfter = balanceBefore - amount;
    await client.query(
      "UPDATE users SET balance = $1, last_used_at = NOW(), updated_at = NOW() WHERE id = $2",
      [balanceAfter, user.id]
    );
    const txRes = await client.query(
      `INSERT INTO transactions
        (user_id, user_name, rfid_uid, type, amount, balance_before, balance_after, description, device_id, source)
       VALUES ($1,$2,$3,'charge',$4,$5,$6,$7,$8,'api')
       RETURNING id`,
      [
        user.id,
        user.name,
        user.rfid_uid,
        amount,
        balanceBefore,
        balanceAfter,
        description,
        req.device.id,
      ]
    );
    await client.query("COMMIT");
    res.json({
      success: true,
      charged: amount,
      balanceBefore,
      balance: balanceAfter,
      transactionId: txRes.rows[0].id,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ success: false, error: "internal_error" });
  } finally {
    client.release();
  }
});

// ── Gestión (sin login por ahora) ──

app.get("/api/settings", async (_req, res) => {
  try {
    const settings = await getSettings();
    res.json({ success: true, settings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "internal_error" });
  }
});

app.patch("/api/settings", async (req, res) => {
  const { defaultChargeAmount, currency, minBalance } = req.body || {};
  try {
    const { rows } = await query(
      `UPDATE settings SET
        default_charge_amount = COALESCE($1, default_charge_amount),
        currency = COALESCE($2, currency),
        min_balance = COALESCE($3, min_balance)
       WHERE id = 1
       RETURNING *`,
      [defaultChargeAmount, currency, minBalance]
    );
    res.json({ success: true, settings: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "internal_error" });
  }
});

app.get("/api/users", async (_req, res) => {
  try {
    const { rows } = await query("SELECT * FROM users ORDER BY created_at DESC");
    res.json({ success: true, users: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "internal_error" });
  }
});

app.get("/api/users/:id", async (req, res) => {
  const userId = Number(req.params.id);
  try {
    const { rows } = await query("SELECT * FROM users WHERE id = $1", [userId]);
    if (!rows[0]) return res.status(404).json({ success: false, error: "user_not_found" });
    const txRes = await query(
      "SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20",
      [userId]
    );
    res.json({ success: true, user: rows[0], transactions: txRes.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "internal_error" });
  }
});

app.post("/api/users", async (req, res) => {
  const rfidUid = normalizeUid(req.body?.rfidUid);
  const name = String(req.body?.name || "").trim();
  const balance = Number(req.body?.balance ?? 0);
  const status = req.body?.status || "active";
  const phone = String(req.body?.phone || "").trim() || null;
  const plate = String(req.body?.plate || "").trim().toUpperCase() || null;
  const notes = String(req.body?.notes || "").trim() || null;
  if (!rfidUid || !name) {
    return res.status(400).json({ success: false, error: "rfid_uid_and_name_required" });
  }
  try {
    const { rows } = await query(
      `INSERT INTO users (rfid_uid, name, balance, status, phone, plate, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [rfidUid, name, balance, status, phone, plate, notes]
    );
    res.status(201).json({ success: true, user: rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ success: false, error: "rfid_uid_exists" });
    }
    console.error(err);
    res.status(500).json({ success: false, error: "internal_error" });
  }
});

app.patch("/api/users/:id", async (req, res) => {
  const userId = Number(req.params.id);
  const body = req.body || {};
  try {
    const current = await query("SELECT * FROM users WHERE id = $1", [userId]);
    if (!current.rows[0]) {
      return res.status(404).json({ success: false, error: "user_not_found" });
    }
    const fields = [];
    const values = [];
    let idx = 1;

    if (body.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(String(body.name).trim());
    }
    if (body.rfidUid !== undefined) {
      fields.push(`rfid_uid = $${idx++}`);
      values.push(normalizeUid(body.rfidUid));
    }
    if (body.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(body.status);
    }
    if (body.phone !== undefined) {
      fields.push(`phone = $${idx++}`);
      values.push(String(body.phone).trim() || null);
    }
    if (body.plate !== undefined) {
      fields.push(`plate = $${idx++}`);
      values.push(String(body.plate).trim().toUpperCase() || null);
    }
    if (body.notes !== undefined) {
      fields.push(`notes = $${idx++}`);
      values.push(String(body.notes).trim() || null);
    }

    if (!fields.length) {
      return res.status(400).json({ success: false, error: "no_fields_to_update" });
    }

    fields.push("updated_at = NOW()");
    values.push(userId);

    const { rows } = await query(
      `UPDATE users SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    res.json({ success: true, user: rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ success: false, error: "rfid_uid_exists" });
    }
    console.error(err);
    res.status(500).json({ success: false, error: "internal_error" });
  }
});

app.delete("/api/users/:id", async (req, res) => {
  const userId = Number(req.params.id);
  try {
    const result = await query("DELETE FROM users WHERE id = $1 RETURNING id", [userId]);
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, error: "user_not_found" });
    }
    res.json({ success: true, deleted: userId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "internal_error" });
  }
});

app.post("/api/users/:id/recharge", async (req, res) => {
  const userId = Number(req.params.id);
  const amount = Number(req.body?.amount);
  const description = req.body?.description || "Recarga manual";
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ success: false, error: "invalid_amount" });
  }

  const client = await require("./db").pool.connect();
  try {
    await client.query("BEGIN");
    const userRes = await client.query("SELECT * FROM users WHERE id = $1 FOR UPDATE", [userId]);
    const user = userRes.rows[0];
    if (!user) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "user_not_found" });
    }
    const balanceBefore = Number(user.balance);
    const balanceAfter = balanceBefore + amount;
    await client.query(
      "UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2",
      [balanceAfter, userId]
    );
    const txRes = await client.query(
      `INSERT INTO transactions
        (user_id, user_name, rfid_uid, type, amount, balance_before, balance_after, description, source)
       VALUES ($1,$2,$3,'recharge',$4,$5,$6,$7,'admin')
       RETURNING id`,
      [user.id, user.name, user.rfid_uid, amount, balanceBefore, balanceAfter, description]
    );
    await client.query("COMMIT");
    res.json({
      success: true,
      balanceBefore,
      balance: balanceAfter,
      transactionId: txRes.rows[0].id,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ success: false, error: "internal_error" });
  } finally {
    client.release();
  }
});

app.get("/api/transactions", async (_req, res) => {
  try {
    const { rows } = await query(
      "SELECT * FROM transactions ORDER BY created_at DESC LIMIT 200"
    );
    res.json({ success: true, transactions: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "internal_error" });
  }
});

app.get("/api/devices", async (_req, res) => {
  try {
    const { rows } = await query("SELECT * FROM devices ORDER BY created_at DESC");
    res.json({ success: true, devices: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "internal_error" });
  }
});

app.post("/api/devices", async (req, res) => {
  const name = String(req.body?.name || "ESP32").trim();
  const apiKey = "dev_" + crypto.randomBytes(16).toString("hex");
  try {
    const { rows } = await query(
      "INSERT INTO devices (name, api_key, active) VALUES ($1, $2, true) RETURNING *",
      [name, apiKey]
    );
    res.status(201).json({ success: true, device: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "internal_error" });
  }
});

app.patch("/api/devices/:id", async (req, res) => {
  const deviceId = Number(req.params.id);
  const { name, active } = req.body || {};
  try {
    const { rows } = await query(
      `UPDATE devices SET
        name = COALESCE($1, name),
        active = COALESCE($2, active)
       WHERE id = $3
       RETURNING *`,
      [name ? String(name).trim() : null, active !== undefined ? Boolean(active) : null, deviceId]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: "device_not_found" });
    res.json({ success: true, device: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "internal_error" });
  }
});

app.get("/api/stats", async (_req, res) => {
  try {
    const [users, settings, txsToday, chargesTotal] = await Promise.all([
      query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='active')::int AS active, COALESCE(SUM(balance),0) AS balance FROM users"),
      query("SELECT * FROM settings WHERE id = 1"),
      query(`SELECT COUNT(*)::int AS count, COALESCE(SUM(amount) FILTER (WHERE type='charge'),0) AS charges, COALESCE(SUM(amount) FILTER (WHERE type='recharge'),0) AS recharges FROM transactions WHERE created_at >= CURRENT_DATE`),
      query("SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE type='charge'"),
    ]);
    const devices = await query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE active=true)::int AS active FROM devices");
    res.json({
      success: true,
      stats: {
        usersTotal: users.rows[0].total,
        usersActive: users.rows[0].active,
        totalBalance: Number(users.rows[0].balance),
        devicesTotal: devices.rows[0].total,
        devicesActive: devices.rows[0].active,
        txsToday: txsToday.rows[0].count,
        chargesToday: Number(txsToday.rows[0].charges),
        rechargesToday: Number(txsToday.rows[0].recharges),
        totalRevenue: Number(chargesTotal.rows[0].total),
        currency: settings.rows[0]?.currency || "USD",
        defaultCharge: Number(settings.rows[0]?.default_charge_amount ?? 5),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "internal_error" });
  }
});

// ── Panel admin (HTML estático) ──

const PUBLIC = path.join(__dirname, "public");
app.use(express.static(PUBLIC));

app.get("/", (_req, res) => {
  res.sendFile(path.join(PUBLIC, "index.html"));
});

app.get("/api-info", (_req, res) => {
  res.json({
    success: true,
    message: "API Sistema Lavado RFID",
    endpoints: {
      health: "GET /health",
      esp32: ["GET /v1/status", "POST /v1/check", "POST /v1/charge"],
      admin: [
        "GET /api/stats",
        "GET /api/users",
        "GET /api/users/:id",
        "POST /api/users",
        "PATCH /api/users/:id",
        "DELETE /api/users/:id",
        "POST /api/users/:id/recharge",
        "GET /api/transactions",
        "GET /api/devices",
        "POST /api/devices",
        "PATCH /api/devices/:id",
        "GET /api/settings",
        "PATCH /api/settings",
      ],
    },
  });
});

async function start() {
  if (!process.env.DATABASE_URL) {
    console.error("ERROR: Falta DATABASE_URL en variables de entorno");
    process.exit(1);
  }
  await initDb();
  app.listen(PORT, () => {
    console.log(`API Lavado RFID → http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("No se pudo iniciar:", err.message);
  process.exit(1);
});
