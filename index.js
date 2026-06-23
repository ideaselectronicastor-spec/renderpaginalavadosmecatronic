require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const admin = require("firebase-admin");

const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!sa) {
  console.error("ERROR: Falta FIREBASE_SERVICE_ACCOUNT en variables de entorno");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(sa)),
});
const db = admin.firestore();

const app = express();
const PORT = process.env.PORT || 3000;
const DIST = path.join(__dirname, "dist");

app.use(cors());
app.use(express.json());

function normalizeUid(uid) {
  return String(uid || "")
    .toUpperCase()
    .replace(/[^A-F0-9]/g, "");
}

async function logApi(action, uid, deviceKey, success, details = {}) {
  try {
    await db.collection("apiLogs").add({
      action,
      uid,
      deviceKey,
      success,
      details,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn("logApi:", e.message);
  }
}

async function findUserByUid(rfidUid) {
  const snap = await db
    .collection("users")
    .where("rfidUid", "==", normalizeUid(rfidUid))
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, data: doc.data() };
}

async function validateDevice(deviceKey) {
  const snap = await db
    .collection("devices")
    .where("apiKey", "==", deviceKey)
    .where("active", "==", true)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  await docSnap.ref.update({
    lastSeen: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { id: docSnap.id, ...docSnap.data() };
}

async function getSettings() {
  const doc = await db.collection("settings").doc("general").get();
  return doc.data() || { defaultChargeAmount: 5, currency: "USD", minBalance: 0 };
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
  } catch {
    res.status(500).json({ success: false, error: "device_validation_failed" });
  }
}

// ── API ESP32 ──

app.get("/health", (_req, res) => {
  res.json({
    success: true,
    service: "sistema-lavado-rfid",
    platform: "render",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

app.post("/v1/check", authDevice, async (req, res) => {
  const uid = normalizeUid(req.body?.uid);
  if (!uid) return res.status(400).json({ success: false, error: "uid_required" });

  try {
    const user = await findUserByUid(uid);
    const settings = await getSettings();
    if (!user) {
      await logApi("check", uid, req.body?.deviceKey, false, { reason: "not_found" });
      return res.json({ success: true, found: false, uid, message: "Tarjeta no registrada" });
    }
    const data = user.data;
    const isActive = data.status === "active";
    await db.collection("users").doc(user.id).update({
      lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await logApi("check", uid, req.body?.deviceKey, true, { userId: user.id });
    res.json({
      success: true,
      found: true,
      uid: data.rfidUid,
      userId: user.id,
      name: data.name,
      balance: data.balance,
      status: data.status,
      active: isActive,
      canUse: isActive && data.balance >= (settings.minBalance ?? 0),
      currency: settings.currency || "USD",
      defaultChargeAmount: settings.defaultChargeAmount ?? 5,
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

  try {
    const user = await findUserByUid(uid);
    if (!user) return res.status(404).json({ success: false, error: "user_not_found" });

    const device = req.device;
    const result = await db.runTransaction(async (tx) => {
      const userRef = db.collection("users").doc(user.id);
      const fresh = await tx.get(userRef);
      const data = fresh.data();
      if (data.status !== "active") throw new Error("user_inactive");
      if (data.balance < amount) throw new Error("insufficient_balance");
      const balanceAfter = data.balance - amount;
      tx.update(userRef, {
        balance: balanceAfter,
        lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      const txRef = db.collection("transactions").doc();
      tx.set(txRef, {
        userId: user.id,
        userName: data.name,
        rfidUid: data.rfidUid,
        type: "charge",
        amount,
        balanceBefore: data.balance,
        balanceAfter,
        description,
        deviceId: device.id,
        deviceName: device.name || "ESP32",
        source: "api",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { balanceBefore: data.balance, balanceAfter, transactionId: txRef.id };
    });

    await logApi("charge", uid, req.body?.deviceKey, true, { amount });
    res.json({
      success: true,
      charged: amount,
      balanceBefore: result.balanceBefore,
      balance: result.balanceAfter,
      transactionId: result.transactionId,
    });
  } catch (err) {
    if (err.message === "user_inactive") {
      return res.status(403).json({ success: false, error: "user_inactive" });
    }
    if (err.message === "insufficient_balance") {
      return res.status(402).json({ success: false, error: "insufficient_balance" });
    }
    console.error(err);
    res.status(500).json({ success: false, error: "internal_error" });
  }
});

// ── Panel web (React build) ──

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/v1/") || req.path === "/health") return next();
    res.sendFile(path.join(DIST, "index.html"));
  });
} else {
  console.warn("AVISO: carpeta dist/ no existe. Ejecuta npm run build");
  app.get("/", (_req, res) => {
    res.send("<h1>Sistema Lavado RFID</h1><p>Ejecuta npm run build para generar el panel.</p>");
  });
}

app.listen(PORT, () => {
  console.log(`Sistema Lavado RFID → http://localhost:${PORT}`);
});
