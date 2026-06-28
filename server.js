'use strict';

// Charge le .env (présent uniquement sur le serveur) AVANT tout le reste,
// pour que les modules qui lisent process.env trouvent leurs secrets.
require('dotenv').config();

const express = require('express');

const app = express();
app.use(express.json({ limit: '256kb' }));

// ---------------------------------------------------------------------
//  M1 — Santé du pipeline. Ne dépend NI de la base NI des secrets :
//  doit répondre dès que le déploiement + PM2 + reverse proxy marchent.
// ---------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'sukiss', ts: new Date().toISOString() });
});

// ---------------------------------------------------------------------
//  Vérification base — utile une fois la Phase 1 (migrations) faite.
//  Chargement paresseux de db.js : l'app démarre même sans DATABASE_URL.
// ---------------------------------------------------------------------
app.get('/health/db', async (req, res) => {
  try {
    const { pool } = require('./db');
    const r = await pool.query('select 1 as ok');
    res.json({ db: 'ok', result: r.rows[0] });
  } catch (e) {
    res.status(500).json({ db: 'erreur', message: e.message });
  }
});

// --- Endpoints métier (Phase 2) ---
app.use('/profil', require('./routes/profil'));
// (match, reveal viendront ensuite)

const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1'; // jamais exposé en direct : le reverse proxy s'en charge
app.listen(PORT, HOST, () => {
  console.log(`Sukiss en écoute sur http://${HOST}:${PORT}`);
});
