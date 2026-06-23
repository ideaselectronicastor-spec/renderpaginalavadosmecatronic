# Sistema Lavado RFID — API en Render

API REST + base de datos PostgreSQL. **Sin Firebase, sin login.**

## Archivos que debes subir a GitHub

Sube **solo estos** (el resto no hace falta):

```
├── index.js          ← Servidor API + panel admin
├── db.js             ← Conexión PostgreSQL
├── package.json
├── public/           ← Panel de control (HTML)
│   ├── index.html
│   ├── admin.css
│   └── admin.js
├── render.yaml       ← Config Render (API + base de datos)
├── .gitignore
├── .env.example
├── README.md
└── esp32/
    └── rfid_lavado.ino   ← Código del ESP32 (opcional)
```

**No subas:** `node_modules/`, `.env`, `package-lock.json`

## Pasos en Render

1. Sube el repo a GitHub
2. En [render.com](https://render.com) → **New** → **Blueprint** → conecta el repo  
   (usa `render.yaml` y crea la API + PostgreSQL automáticamente)

   **O manualmente:**
   - Crea **PostgreSQL** (Free)
   - Crea **Web Service** (Node)
   - Build: `npm install`
   - Start: `npm start`
   - Variable: `DATABASE_URL` = Internal Database URL de PostgreSQL

3. Cuando arranque, abre tu URL → verás el **panel de administración**

## Panel de control

Abre la URL de Render en el navegador (ej. `https://tu-app.onrender.com`):

- **Inicio** — resumen y últimos movimientos
- **Usuarios** — crear y recargar saldo
- **Transacciones** — historial
- **Dispositivos** — API keys para ESP32
- **Configuración** — cobro por lavado, moneda
- **Guía API** — documentación con ejemplos

Sin login por ahora (cualquiera con la URL puede entrar).

## Endpoints ESP32

Header: `X-Device-Key: dev_xxxx`

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Estado del servicio |
| POST | `/v1/check` | Consultar tarjeta `{ "uid": "A1B2C3D4" }` |
| POST | `/v1/charge` | Cobrar `{ "uid": "A1B2C3D4", "amount": 5 }` |

## Endpoints gestión (sin login)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/users` | Listar usuarios |
| POST | `/api/users` | Crear `{ "rfidUid": "A1B2C3D4", "name": "Juan", "balance": 10 }` |
| POST | `/api/users/:id/recharge` | Recargar `{ "amount": 20 }` |
| GET | `/api/transactions` | Ver movimientos |
| GET | `/api/devices` | Ver dispositivos y API keys |
| POST | `/api/devices` | Crear dispositivo `{ "name": "Lavadora 1" }` |
| GET/PATCH | `/api/settings` | Configuración |

## ESP32

```cpp
const char* API_BASE = "https://TU-APP.onrender.com";
const char* DEVICE_KEY = "dev_tu_api_key";
```
