'use strict';

// ---------------------------------------------------------------------
//  Pool de connexions PostgreSQL, alimenté par DATABASE_URL (.env).
//  Fail-closed : on refuse de démarrer sans chaîne de connexion.
// ---------------------------------------------------------------------

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL non défini — vérifier le .env sur le serveur.");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = { pool };
