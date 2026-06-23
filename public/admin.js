const API = window.location.origin;
let allUsers = [];
let allTransactions = [];
let currency = "USD";
let txFilter = "all";

const TITLES = {
  dashboard: ["Dashboard", "Resumen del lavadero"],
  clients: ["Clientes", "Gestión de clientes y tarjetas RFID"],
  transactions: ["Transacciones", "Historial de lavados y recargas"],
  devices: ["Dispositivos", "Puntos de lavado ESP32"],
  settings: ["Configuración", "Precios y parámetros del sistema"],
  api: ["Guía API", "Documentación para ESP32"],
};

function toast(msg, type = "success") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById("toasts").appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data.error || "Error en la solicitud";
    throw new Error(err === "rfid_uid_exists" ? "Esa tarjeta RFID ya está registrada" : err);
  }
  return data;
}

function fmtMoney(n, cur = currency) {
  return new Intl.NumberFormat("es", { style: "currency", currency: cur }).format(Number(n));
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function openModal(id) { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }

function toggleSidebar(open) {
  document.getElementById("sidebar").classList.toggle("open", open);
  document.getElementById("sidebar-backdrop").classList.toggle("open", open);
}

document.getElementById("menu-btn").addEventListener("click", () => {
  const open = !document.getElementById("sidebar").classList.contains("open");
  toggleSidebar(open);
});

document.getElementById("sidebar-backdrop").addEventListener("click", () => toggleSidebar(false));

function switchTab(id) {
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
  document.getElementById("panel-" + id).classList.add("active");
  document.querySelector(`.nav-item[data-tab="${id}"]`).classList.add("active");
  const [title, sub] = TITLES[id] || ["Panel", ""];
  document.getElementById("page-title").textContent = title;
  document.getElementById("page-subtitle").textContent = sub;
  toggleSidebar(false);
  if (id === "dashboard") loadDashboard();
  if (id === "clients") loadUsers();
  if (id === "transactions") loadTransactions();
  if (id === "devices") loadDevices();
  if (id === "settings") loadSettings();
  if (id === "api") updateApiGuide();
}

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function toggleForm(id) {
  const el = document.getElementById(id);
  el.style.display = el.style.display === "none" ? "block" : "none";
}

async function loadDashboard() {
  try {
    const [{ stats }, { transactions }] = await Promise.all([
      api("/api/stats"),
      api("/api/transactions"),
    ]);
    currency = stats.currency;

    document.getElementById("stats-grid").innerHTML = `
      <div class="stat-card highlight">
        <div class="stat-header"><span class="stat-label">Clientes activos</span><div class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div></div>
        <div class="stat-value">${stats.usersActive}</div>
        <div class="stat-meta">de ${stats.usersTotal} registrados</div>
      </div>
      <div class="stat-card">
        <div class="stat-header"><span class="stat-label">Saldo en circulación</span><div class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div></div>
        <div class="stat-value">${fmtMoney(stats.totalBalance)}</div>
        <div class="stat-meta">Saldo total clientes</div>
      </div>
      <div class="stat-card">
        <div class="stat-header"><span class="stat-label">Lavados hoy</span><div class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 17h14v-5H5v5z"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/></svg></div></div>
        <div class="stat-value">${fmtMoney(stats.chargesToday)}</div>
        <div class="stat-meta">${stats.txsToday} movimientos hoy</div>
      </div>
      <div class="stat-card">
        <div class="stat-header"><span class="stat-label">Ingresos totales</span><div class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></div></div>
        <div class="stat-value">${fmtMoney(stats.totalRevenue)}</div>
        <div class="stat-meta">Precio lavado: ${fmtMoney(stats.defaultCharge)}</div>
      </div>`;

    const recent = transactions.slice(0, 8);
    const tbody = document.querySelector("#recent-txs tbody");
    tbody.innerHTML = recent.length
      ? recent.map((tx) => txRowSimple(tx)).join("")
      : `<tr><td colspan="5" class="empty-state">Sin movimientos recientes</td></tr>`;

    document.getElementById("recent-cards").innerHTML = recent.length
      ? recent.map((tx) => txCard(tx)).join("")
      : `<div class="empty-state">Sin movimientos recientes</div>`;
  } catch (e) {
    toast(e.message, "error");
  }
}

function txRowSimple(tx) {
  const sign = tx.type === "charge" ? "−" : "+";
  const cls = tx.type === "charge" ? "type-charge" : "type-recharge";
  const label = tx.type === "charge" ? "Lavado" : "Recarga";
  return `<tr>
    <td>${fmtDate(tx.created_at)}</td>
    <td>${esc(tx.user_name) || "—"}</td>
    <td class="mono">${esc(tx.rfid_uid) || "—"}</td>
    <td class="${cls}">${sign}${fmtMoney(tx.amount)}</td>
    <td><span class="badge badge-${tx.type}">${label}</span></td>
  </tr>`;
}

function txCard(tx) {
  const sign = tx.type === "charge" ? "−" : "+";
  const cls = tx.type === "charge" ? "type-charge" : "type-recharge";
  return `<div class="user-card">
    <div class="user-card-top">
      <div><div class="user-card-name">${esc(tx.user_name) || "—"}</div><div class="user-card-plate">${esc(tx.rfid_uid) || ""}</div></div>
      <span class="badge badge-${tx.type}">${tx.type === "charge" ? "Lavado" : "Recarga"}</span>
    </div>
    <div class="${cls}" style="font-size:1.25rem;font-weight:700">${sign}${fmtMoney(tx.amount)}</div>
    <div style="font-size:0.75rem;color:var(--muted);margin-top:0.35rem">${fmtDate(tx.created_at)}</div>
  </div>`;
}

async function loadUsers() {
  try {
    const [{ users }, { settings }] = await Promise.all([
      api("/api/users"),
      api("/api/settings"),
    ]);
    allUsers = users;
    currency = settings.currency;
    renderUsers(filterUsers(document.getElementById("search-clients").value));
  } catch (e) {
    toast(e.message, "error");
  }
}

function filterUsers(q) {
  q = (q || "").trim().toLowerCase();
  if (!q) return allUsers;
  return allUsers.filter(
    (u) =>
      u.name.toLowerCase().includes(q) ||
      (u.plate && u.plate.toLowerCase().includes(q)) ||
      u.rfid_uid.toLowerCase().includes(q) ||
      (u.phone && u.phone.includes(q))
  );
}

function renderUsers(users) {
  const tbody = document.querySelector("#users-table tbody");
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No hay clientes registrados</td></tr>`;
    document.getElementById("users-cards").innerHTML = `<div class="empty-state">No hay clientes</div>`;
    return;
  }

  tbody.innerHTML = users
    .map(
      (u) => `<tr>
      <td><strong>${esc(u.name)}</strong>${u.phone ? `<br><span style="color:var(--muted);font-size:0.8rem">${esc(u.phone)}</span>` : ""}</td>
      <td class="mono">${esc(u.plate) || "—"}</td>
      <td class="mono">${esc(u.rfid_uid)}</td>
      <td><strong>${fmtMoney(u.balance)}</strong></td>
      <td><span class="badge badge-${u.status}">${u.status === "active" ? "Activo" : "Inactivo"}</span></td>
      <td>
        <div class="btn-group">
          <button class="btn btn-sm btn-success" onclick="openRecharge(${u.id},'${esc(u.name).replace(/'/g, "\\'")}')">Recargar</button>
          <button class="btn btn-sm btn-secondary" onclick="openEdit(${u.id})">Editar</button>
        </div>
      </td>
    </tr>`
    )
    .join("");

  document.getElementById("users-cards").innerHTML = users
    .map(
      (u) => `<div class="user-card">
      <div class="user-card-top">
        <div>
          <div class="user-card-name">${esc(u.name)}</div>
          <div class="user-card-plate">${esc(u.plate) || esc(u.rfid_uid)}</div>
        </div>
        <span class="badge badge-${u.status}">${u.status === "active" ? "Activo" : "Inactivo"}</span>
      </div>
      <div class="user-card-meta">
        <div>Saldo<strong>${fmtMoney(u.balance)}</strong></div>
        <div>UID<strong class="mono">${esc(u.rfid_uid)}</strong></div>
      </div>
      <div class="btn-group">
        <button class="btn btn-sm btn-success" onclick="openRecharge(${u.id},'${esc(u.name).replace(/'/g, "\\'")}')">Recargar</button>
        <button class="btn btn-sm btn-secondary" onclick="openEdit(${u.id})">Editar</button>
      </div>
    </div>`
    )
    .join("");
}

document.getElementById("search-clients").addEventListener("input", (e) => {
  renderUsers(filterUsers(e.target.value));
});

document.getElementById("form-user").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        rfidUid: fd.get("rfidUid"),
        name: fd.get("name"),
        plate: fd.get("plate"),
        phone: fd.get("phone"),
        notes: fd.get("notes"),
        balance: Number(fd.get("balance") || 0),
        status: fd.get("status"),
      }),
    });
    toast("Cliente registrado");
    e.target.reset();
    loadUsers();
    loadDashboard();
  } catch (err) {
    toast(err.message, "error");
  }
});

function openRecharge(id, name) {
  document.getElementById("recharge-id").value = id;
  document.getElementById("recharge-name").textContent = name;
  document.getElementById("recharge-amount").value = "";
  document.getElementById("recharge-desc").value = "";
  openModal("modal-recharge");
}

document.getElementById("form-recharge").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("recharge-id").value;
  const amount = Number(document.getElementById("recharge-amount").value);
  const description = document.getElementById("recharge-desc").value || "Recarga manual";
  try {
    await api(`/api/users/${id}/recharge`, {
      method: "POST",
      body: JSON.stringify({ amount, description }),
    });
    toast("Recarga exitosa");
    closeModal("modal-recharge");
    loadUsers();
    loadDashboard();
  } catch (err) {
    toast(err.message, "error");
  }
});

async function openEdit(id) {
  try {
    const { user } = await api(`/api/users/${id}`);
    document.getElementById("edit-id").value = user.id;
    document.getElementById("edit-name").value = user.name || "";
    document.getElementById("edit-plate").value = user.plate || "";
    document.getElementById("edit-rfid").value = user.rfid_uid || "";
    document.getElementById("edit-phone").value = user.phone || "";
    document.getElementById("edit-status").value = user.status || "active";
    document.getElementById("edit-notes").value = user.notes || "";
    openModal("modal-edit");
  } catch (err) {
    toast(err.message, "error");
  }
}

document.getElementById("form-edit").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("edit-id").value;
  try {
    await api(`/api/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: document.getElementById("edit-name").value,
        rfidUid: document.getElementById("edit-rfid").value,
        plate: document.getElementById("edit-plate").value,
        phone: document.getElementById("edit-phone").value,
        status: document.getElementById("edit-status").value,
        notes: document.getElementById("edit-notes").value,
      }),
    });
    toast("Cliente actualizado");
    closeModal("modal-edit");
    loadUsers();
  } catch (err) {
    toast(err.message, "error");
  }
});

async function confirmDelete() {
  const id = document.getElementById("edit-id").value;
  if (!confirm("¿Eliminar este cliente? Esta acción no se puede deshacer.")) return;
  try {
    await api(`/api/users/${id}`, { method: "DELETE" });
    toast("Cliente eliminado");
    closeModal("modal-edit");
    loadUsers();
    loadDashboard();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function loadTransactions() {
  try {
    const { transactions } = await api("/api/transactions");
    allTransactions = transactions;
    renderTransactions();
  } catch (e) {
    toast(e.message, "error");
  }
}

function renderTransactions() {
  const list =
    txFilter === "all" ? allTransactions : allTransactions.filter((t) => t.type === txFilter);
  const tbody = document.querySelector("#txs-table tbody");
  tbody.innerHTML = list.length
    ? list
        .map(
          (tx) => `<tr>
      <td>${fmtDate(tx.created_at)}</td>
      <td>${esc(tx.user_name) || "—"}</td>
      <td class="mono">${esc(tx.rfid_uid) || "—"}</td>
      <td><span class="badge badge-${tx.type}">${tx.type === "charge" ? "Lavado" : "Recarga"}</span></td>
      <td class="${tx.type === "charge" ? "type-charge" : "type-recharge"}">${tx.type === "charge" ? "−" : "+"}${fmtMoney(tx.amount)}</td>
      <td>${fmtMoney(tx.balance_after)}</td>
      <td>${esc(tx.description) || "—"}</td>
    </tr>`
        )
        .join("")
    : `<tr><td colspan="7" class="empty-state">Sin transacciones</td></tr>`;
}

document.getElementById("tx-filters").addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-tab");
  if (!btn) return;
  document.querySelectorAll("#tx-filters .filter-tab").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  txFilter = btn.dataset.filter;
  renderTransactions();
});

async function loadDevices() {
  try {
    const { devices } = await api("/api/devices");
    const tbody = document.querySelector("#devices-table tbody");
    tbody.innerHTML = devices.length
      ? devices
          .map(
            (d) => `<tr>
        <td><strong>${esc(d.name)}</strong></td>
        <td class="mono">${esc(d.api_key)}</td>
        <td><span class="badge badge-${d.active ? "active" : "inactive"}">${d.active ? "Activo" : "Inactivo"}</span></td>
        <td>${fmtDate(d.last_seen)}</td>
        <td>
          <div class="btn-group">
            <button class="btn btn-sm btn-secondary" onclick="copyKey('${d.api_key}')">Copiar</button>
            <button class="btn btn-sm btn-warning" onclick="openEditDevice(${d.id},'${esc(d.name).replace(/'/g, "\\'")}',${d.active})">Editar</button>
          </div>
        </td>
      </tr>`
          )
          .join("")
      : `<tr><td colspan="5" class="empty-state">No hay dispositivos</td></tr>`;
  } catch (e) {
    toast(e.message, "error");
  }
}

function openEditDevice(id, name, active) {
  document.getElementById("device-edit-id").value = id;
  document.getElementById("device-edit-name").value = name;
  document.getElementById("device-edit-active").value = String(active);
  openModal("modal-device");
}

document.getElementById("form-edit-device").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("device-edit-id").value;
  try {
    await api(`/api/devices/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: document.getElementById("device-edit-name").value,
        active: document.getElementById("device-edit-active").value === "true",
      }),
    });
    toast("Dispositivo actualizado");
    closeModal("modal-device");
    loadDevices();
  } catch (err) {
    toast(err.message, "error");
  }
});

document.getElementById("form-device").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("device-name").value;
  try {
    const { device } = await api("/api/devices", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    toast("Dispositivo creado: " + device.api_key);
    e.target.reset();
    loadDevices();
  } catch (err) {
    toast(err.message, "error");
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
    toast(e.message, "error");
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
    toast(err.message, "error");
  }
});

function updateApiGuide() {
  document.querySelectorAll("[data-base]").forEach((el) => {
    if (el.dataset.baseInit) return;
    el.textContent = el.textContent.replace(/\{\{BASE\}\}/g, API);
    el.dataset.baseInit = "1";
  });
}

async function testWakeServer() {
  const el = document.getElementById("wake-test-result");
  el.textContent = "Despertando servidor... (puede tardar ~60 s)";
  el.style.color = "var(--warning)";
  const t0 = Date.now();
  try {
    const res = await fetch(API + "/v1/status");
    const data = await res.json();
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    if (data.status === "ok") {
      el.textContent = `✓ status: ok — respondió en ${sec}s`;
      el.style.color = "var(--success)";
      toast(`Servidor despierto (${sec}s)`);
    } else {
      el.textContent = "Respuesta inesperada: " + JSON.stringify(data);
      el.style.color = "var(--danger)";
    }
  } catch (err) {
    el.textContent = "Error: " + err.message;
    el.style.color = "var(--danger)";
    toast("No se pudo conectar. ¿Render dormido?", "error");
  }
}

document.getElementById("btn-test-wake").addEventListener("click", testWakeServer);

document.querySelectorAll(".modal-overlay").forEach((m) => {
  m.addEventListener("click", (e) => {
    if (e.target === m) closeModal(m.id);
  });
});

switchTab("dashboard");
