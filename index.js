require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
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

// ── Salud ──

app.get("/health", (_req, res) => {
  res.json({
    success: true,
    service: "sistema-lavado-rfid",
    platform: "render",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
  });
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

app.post("/api/users", async (req, res) => {
  const rfidUid = normalizeUid(req.body?.rfidUid);
  const name = String(req.body?.name || "").trim();
  const balance = Number(req.body?.balance ?? 0);
  const status = req.body?.status || "active";
  if (!rfidUid || !name) {
    return res.status(400).json({ success: false, error: "rfid_uid_and_name_required" });
  }
  try {
    const { rows } = await query(
      `INSERT INTO users (rfid_uid, name, balance, status)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [rfidUid, name, balance, status]
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

app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "API Sistema Lavado RFID",
    endpoints: {
      health: "GET /health",
      esp32: ["POST /v1/check", "POST /v1/charge"],
      admin: [
        "GET /api/users",
        "POST /api/users",
        "POST /api/users/:id/recharge",
        "GET /api/transactions",
        "GET /api/devices",
        "POST /api/devices",
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
