'use strict';

// ---------------------------------------------------------------------
//  Lanceur de migrations simple et idempotent.
//  - applique les fichiers migrations/*.sql dans l'ordre alphabétique
//  - chaque migration tourne dans une transaction (tout ou rien)
//  - une table schema_migrations garde la trace de ce qui est appliqué
//
//  Pré-requis : l'extension pgcrypto doit déjà exister dans la base
//  (à créer une fois en superuser : CREATE EXTENSION IF NOT EXISTS pgcrypto;)
//  car l'utilisateur applicatif `app` n'a pas le droit de la créer.
// ---------------------------------------------------------------------

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

async function migrate() {
  const dir = path.join(__dirname, '..', 'migrations');
  const fichiers = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  await pool.query(`create table if not exists schema_migrations (
    nom         text        primary key,
    applique_le timestamptz not null default now()
  )`);

  for (const f of fichiers) {
    const deja = await pool.query('select 1 from schema_migrations where nom = $1', [f]);
    if (deja.rowCount) {
      console.log(`=  déjà appliquée : ${f}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations(nom) values ($1)', [f]);
      await client.query('commit');
      console.log(`OK appliquée : ${f}`);
    } catch (e) {
      await client.query('rollback');
      console.error(`ECHEC sur ${f} : ${e.message}`);
      throw e;
    } finally {
      client.release();
    }
  }

  await pool.end();
  console.log('Migrations terminées.');
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
