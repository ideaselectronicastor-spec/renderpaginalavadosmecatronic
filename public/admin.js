const API = window.location.origin;

function toast(msg, isError = false) {
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Error en la solicitud");
  return data;
}

function fmtMoney(n, currency = "USD") {
  return new Intl.NumberFormat("es", { style: "currency", currency }).format(Number(n));
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es");
}

function switchTab(id) {
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
  document.getElementById("panel-" + id).classList.add("active");
  document.querySelector(`nav button[data-tab="${id}"]`).classList.add("active");
  if (id === "dashboard") loadDashboard();
  if (id === "users") loadUsers();
  if (id === "transactions") loadTransactions();
  if (id === "devices") loadDevices();
  if (id === "settings") loadSettings();
  if (id === "api") updateApiGuide();
}

async function loadDashboard() {
  try {
    const [users, txs, settings] = await Promise.all([
      api("/api/users"),
      api("/api/transactions"),
      api("/api/settings"),
    ]);
    const totalBalance = users.users.reduce((s, u) => s + Number(u.balance), 0);
    document.getElementById("stat-users").textContent = users.users.length;
    document.getElementById("stat-balance").textContent = fmtMoney(totalBalance, settings.settings.currency);
    document.getElementById("stat-txs").textContent = txs.transactions.length;
    const tbody = document.querySelector("#recent-txs tbody");
    tbody.innerHTML = txs.transactions.slice(0, 5).map(txRow).join("") || '<tr><td colspan="5" class="empty">Sin movimientos</td></tr>';
  } catch (e) {
    toast(e.message, true);
  }
}

function txRow(tx) {
  const cls = tx.type === "charge" ? "type-charge" : "type-recharge";
  const sign = tx.type === "charge" ? "−" : "+";
  return `<tr>
    <td>${fmtDate(tx.created_at)}</td>
    <td>${tx.user_name || "—"}</td>
    <td class="${cls}">${sign}${fmtMoney(tx.amount)}</td>
    <td>${tx.description || "—"}</td>
    <td><span class="status status-${tx.type === "charge" ? "inactive" : "active"}">${tx.type}</span></td>
  </tr>`;
}

async function loadUsers() {
  try {
    const { users } = await api("/api/users");
    const { settings } = await api("/api/settings");
    const tbody = document.querySelector("#users-table tbody");
    tbody.innerHTML = users.map((u) => `
      <tr>
        <td class="mono">${u.rfid_uid}</td>
        <td>${u.name}</td>
        <td>${fmtMoney(u.balance, settings.currency)}</td>
        <td><span class="status status-${u.status}">${u.status}</span></td>
        <td>
          <button class="btn btn-sm btn-success" onclick="openRecharge(${u.id}, '${u.name.replace(/'/g, "\\'")}')">Recargar</button>
        </td>
      </tr>`).join("") || '<tr><td colspan="5" class="empty">No hay usuarios</td></tr>';
  } catch (e) {
    toast(e.message, true);
  }
}

document.getElementById("form-user").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        rfidUid: fd.get("rfidUid"),
        name: fd.get("name"),
        balance: Number(fd.get("balance") || 0),
        status: fd.get("status"),
      }),
    });
    toast("Usuario creado");
    e.target.reset();
    loadUsers();
    loadDashboard();
  } catch (err) {
    toast(err.message === "rfid_uid_exists" ? "Esa tarjeta ya existe" : err.message, true);
  }
});

function openRecharge(id, name) {
  document.getElementById("recharge-id").value = id;
  document.getElementById("recharge-name").textContent = name;
  document.getElementById("recharge-amount").value = "";
  document.getElementById("modal-recharge").style.display = "flex";
}

function closeRecharge() {
  document.getElementById("modal-recharge").style.display = "none";
}

document.getElementById("form-recharge").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("recharge-id").value;
  const amount = Number(document.getElementById("recharge-amount").value);
  try {
    await api(`/api/users/${id}/recharge`, {
      method: "POST",
      body: JSON.stringify({ amount }),
    });
    toast("Recarga exitosa");
    closeRecharge();
    loadUsers();
    loadDashboard();
  } catch (err) {
    toast(err.message, true);
  }
});

async function loadTransactions() {
  try {
    const { transactions } = await api("/api/transactions");
    const tbody = document.querySelector("#txs-table tbody");
    tbody.innerHTML = transactions.map((tx) => `
      <tr>
        <td>${fmtDate(tx.created_at)}</td>
        <td class="mono">${tx.rfid_uid || "—"}</td>
        <td>${tx.user_name || "—"}</td>
        <td class="${tx.type === "charge" ? "type-charge" : "type-recharge"}">${tx.type}</td>
        <td>${fmtMoney(tx.amount)}</td>
        <td>${fmtMoney(tx.balance_after)}</td>
        <td>${tx.description || "—"}</td>
        <td>${tx.source}</td>
      </tr>`).join("") || '<tr><td colspan="8" class="empty">Sin transacciones</td></tr>';
  } catch (e) {
    toast(e.message, true);
  }
}

async function loadDevices() {
  try {
    const { devices } = await api("/api/devices");
    const tbody = document.querySelector("#devices-table tbody");
    tbody.innerHTML = devices.map((d) => `
      <tr>
        <td>${d.name}</td>
        <td class="mono">${d.api_key}</td>
        <td><span class="status status-${d.active ? "active" : "inactive"}">${d.active ? "activo" : "inactivo"}</span></td>
        <td>${fmtDate(d.last_seen)}</td>
        <td><button class="btn btn-sm btn-secondary" onclick="copyKey('${d.api_key}')">Copiar key</button></td>
      </tr>`).join("") || '<tr><td colspan="5" class="empty">No hay dispositivos</td></tr>';
  } catch (e) {
    toast(e.message, true);
  }
}

document.getElementById("form-device").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("device-name").value;
  try {
    const { device } = await api("/api/devices", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    toast("Dispositivo creado. Key: " + device.api_key);
    e.target.reset();
    loadDevices();
  } catch (err) {
    toast(err.message, true);
  }
});

function copyKey(key) {
  navigator.clipboard.writeText(key).then(() => toast("API Key copiada"));
}

async function loadSettings() {
  try {
    const { settings } = await api("/api/settings");
    document.getElementById("set-charge").value = settings.default_charge_amount;
    document.getElementById("set-currency").value = settings.currency;
    document.getElementById("set-min").value = settings.min_balance;
  } catch (e) {
    toast(e.message, true);
  }
}

document.getElementById("form-settings").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        defaultChargeAmount: Number(document.getElementById("set-charge").value),
        currency: document.getElementById("set-currency").value,
        minBalance: Number(document.getElementById("set-min").value),
      }),
    });
    toast("Configuración guardada");
  } catch (err) {
    toast(err.message, true);
  }
});

function updateApiGuide() {
  document.querySelectorAll("[data-base]").forEach((el) => {
    el.textContent = el.textContent.replace(/\{\{BASE\}\}/g, API);
  });
}

document.querySelectorAll("nav button").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

document.getElementById("modal-recharge").addEventListener("click", (e) => {
  if (e.target.id === "modal-recharge") closeRecharge();
});

switchTab("dashboard");
