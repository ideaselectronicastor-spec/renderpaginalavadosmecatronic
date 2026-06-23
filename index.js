const express = require('express');
const cors = require('cors');

const app = express();

// Middlewares globales obligatorios
app.use(cors());
app.use(express.json()); // Permite a Express entender los JSON que envías desde Postman o el ESP32

// 1. Endpoint de prueba/diagnóstico (GET /api/health)
app.get('/api/health', (req, res) => {
    return res.status(200).json({ 
        status: "success", 
        message: "API de Lavados Mecatronic corriendo exitosamente en Render" 
    });
});

// 2. Endpoint para verificar tarjeta (POST /api/check)
app.post('/api/check', (req, res) => {
    try {
        const { uid, deviceKey } = req.body;

        // Validación básica de parámetros
        if (!uid || !deviceKey) {
            return res.status(400).json({ 
                status: "error", 
                message: "Faltan parámetros obligatorios: 'uid' o 'deviceKey'" 
            });
        }

        // Simulación temporal de respuesta exitosa mientras conectas tu base de datos
        // Aquí verificarás la API key 'dev_ENknbix0wKGSJKKpJwZ52IPDcYfEgii8'
        if (deviceKey !== "dev_ENknbix0wKGSJKKpJwZ52IPDcYfEgii8") {
            return res.status(401).json({ 
                status: "unauthorized", 
                message: "La clave de dispositivo (deviceKey) es inválida." 
            });
        }

        // Si la clave es correcta, devolvemos un estado simulado
        return res.status(200).json({
            status: "success",
            exists: true,
            balance: 25.50,
            active: true,
            uid: uid
        });

    } catch (error) {
        return res.status(500).json({ 
            status: "error", 
            message: error.message 
        });
    }
});

// El puerto DEBE ser process.env.PORT para que Render asigne su puerto interno
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor de desarrollo activo en el puerto ${PORT}`);
});
