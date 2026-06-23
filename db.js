const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

async function query(text, params) {
  return pool.query(text, params);
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      rfid_uid VARCHAR(32) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      balance NUMERIC(10,2) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS devices (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL DEFAULT 'ESP32',
      api_key VARCHAR(64) UNIQUE NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      user_name VARCHAR(255),
      rfid_uid VARCHAR(32),
      type VARCHAR(20) NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      balance_before NUMERIC(10,2),
      balance_after NUMERIC(10,2),
      description TEXT,
      device_id INT REFERENCES devices(id) ON DELETE SET NULL,
      source VARCHAR(20) NOT NULL DEFAULT 'api',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INT PRIMARY KEY DEFAULT 1,
      default_charge_amount NUMERIC(10,2) NOT NULL DEFAULT 5,
      currency VARCHAR(10) NOT NULL DEFAULT 'USD',
      min_balance NUMERIC(10,2) NOT NULL DEFAULT 0
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS plate VARCHAR(20);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notes TEXT;
  `);

  const settings = await query("SELECT id FROM settings WHERE id = 1");
  if (settings.rowCount === 0) {
    await query(
      "INSERT INTO settings (id, default_charge_amount, currency, min_balance) VALUES (1, 5, 'USD', 0)"
    );
  }

  const devices = await query("SELECT id FROM devices LIMIT 1");
  if (devices.rowCount === 0) {
    const apiKey = "dev_" + require("crypto").randomBytes(16).toString("hex");
    await query(
      "INSERT INTO devices (name, api_key, active) VALUES ($1, $2, true)",
      ["ESP32 Principal", apiKey]
    );
    console.log("Dispositivo inicial creado. API Key:", apiKey);
  }
}

module.exports = { pool, query, initDb };
