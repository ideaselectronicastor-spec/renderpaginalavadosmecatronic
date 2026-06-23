const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DIST = path.join(__dirname, "dist");

// Middlewares estándar de producción
app.use(cors());
app.use(express.json());

// Endpoint de diagnóstico rápido para la API
app.get("/health", (_req, res) => {
  res.json({
    success: true,
    status: "online",
    service: "sistema-lavado-rfid-test",
    timestamp: new Date().toISOString(),
  });
});

// Enrutamiento del Panel Web
if (fs.existsSync(DIST)) {
  // Si la carpeta dist existe (por ejemplo, compilada por React), la sirve
  app.use(express.static(DIST));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/v1/") || req.path === "/health") return next();
    res.sendFile(path.join(DIST, "index.html"));
  });
} else {
  // Si no existe la carpeta 'dist', muestra esta página web limpia de prueba para verificar que abre
  app.get("*", (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Sistema Lavado RFID - Render Test</title>
          <style>
              body {
                  font-family: 'Arial', sans-serif;
                  background-color: #0f172a;
                  color: #f8fafc;
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  justify-content: center;
                  height: 100vh;
                  margin: 0;
              }
              .card {
                  background: #1e293b;
                  padding: 30px;
                  border-radius: 12px;
                  box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
                  text-align: center;
                  border: 1px solid #334155;
              }
              h1 { color: #38bdf8; margin-bottom: 10px; }
              p { color: #94a3b8; font-size: 16px; }
              .badge {
                  background-color: #22c55e;
                  color: white;
                  padding: 6px 12px;
                  border-radius: 20px;
                  font-size: 14px;
                  font-weight: bold;
                  display: inline-block;
                  margin-top: 15px;
              }
          </style>
      </head>
      <body>
          <div class="card">
              <h1>Mecatronic Lavados</h1>
              <p>El servidor de Render se ha configurado y desplegado de manera exitosa.</p>
              <span class="badge">Servidor Online</span>
          </div>
      </body>
      </html>
    `);
  });
}

app.listen(PORT, () => {
  console.log(`Servidor de prueba corriendo de manera autónoma en el puerto: ${PORT}`);
});
