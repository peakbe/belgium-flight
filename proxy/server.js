// =============================
//  server.js – ESM / Render Ready
// =============================

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';

// Reconstituer __dirname en ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Créer app
const app = express();

// Middlewares
app.use(helmet());
app.use(cors());
app.use(express.json());

// (Optionnel) Servir un frontend statique depuis /public
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Route racine (utile pour Render)
app.get('/', (req, res) => {
  res.type('text/plain').send('OK - Service up');
});

// Healthcheck
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    env: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

// Exemple d’async route avec try/catch correct
app.get('/api/example', async (req, res, next) => {
  try {
    // ... ton code ici
    res.json({ data: 'example' });
  } catch (err) {
    next(err);
  }
});

// =============================
//  Flights route
// =============================

app.get('/api/flights', async (req, res, next) => {
  try {
    // Exemple statique — on pluggera ensuite une vraie DB
    const flights = [
      {
        id: 1,
        from: "BRU",
        to: "LGG",
        departure: "2026-03-20T14:00:00Z",
        arrival: "2026-03-20T14:25:00Z",
        status: "scheduled"
      },
      {
        id: 2,
        from: "LGG",
        to: "CDG",
        departure: "2026-03-20T15:40:00Z",
        arrival: "2026-03-20T16:30:00Z",
        status: "boarding"
      }
    ];

    res.json({ flights });
  } catch (err) {
    next(err);
  }
});

// 404 pour API
app.use('/api', (req, res) => {
  res.status(404).json({ error: true, message: 'Not Found' });
});

// Global error handler
// (⚠️ ne met PAS de "try" au niveau global ; Node gère le top-level async)
app.use((err, req, res, next) => {
  console.error('🔥 Server error:', err);
  const status = err.status || 500;
  res.status(status).json({
    error: true,
    message: err.message || 'Internal Server Error',
  });
});

// Lancer serveur sur le port imposé par Render
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
