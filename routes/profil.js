'use strict';

// =====================================================================
//  POST /profil — création d'un profil.
//  - chiffre les réponses (AES-256-GCM) : jamais stockées en clair
//  - génère un code partageable + une phrase de récupération
//  - ne stocke que les HMAC du code et de la phrase
//  - renvoie code + phrase EN CLAIR UNE SEULE FOIS (au client de les garder)
//
//  Aucune réponse, aucun code, aucune phrase n'est journalisé.
// =====================================================================

const express = require('express');
const { pool } = require('../db');
const chiffrement = require('../lib/chiffrement');

const router = express.Router();

router.post('/', async (req, res) => {
  const reponses = req.body && req.body.reponses;

  // Validation minimale : un objet de réponses non vide.
  if (
    !reponses ||
    typeof reponses !== 'object' ||
    Array.isArray(reponses) ||
    Object.keys(reponses).length === 0
  ) {
    return res.status(400).json({ erreur: 'reponses manquantes ou invalides' });
  }

  const versionQuestions = Number.isInteger(req.body.versionQuestions)
    ? req.body.versionQuestions
    : 1;

  // Chiffrement des réponses + génération des secrets partageables.
  const { reponsesChiffrees, iv, authTag, versionCle } = chiffrement.chiffrerProfil(reponses);
  const code = chiffrement.genererJeton();
  const phrase = chiffrement.genererPhraseRecuperation();

  const client = await pool.connect();
  try {
    await client.query('begin');

    const ins = await client.query(
      `insert into profils (reponses_chiffrees, iv, auth_tag, version_cle, version_questions)
       values ($1, $2, $3, $4, $5) returning id`,
      [reponsesChiffrees, iv, authTag, versionCle, versionQuestions]
    );
    const profilId = ins.rows[0].id;

    await client.query('insert into codes (profil_id, jeton_hmac) values ($1, $2)', [
      profilId,
      chiffrement.hmacJeton(code),
    ]);
    await client.query('insert into recuperation (profil_id, phrase_hmac) values ($1, $2)', [
      profilId,
      chiffrement.hmacPhrase(phrase),
    ]);

    await client.query('commit');

    // UNE SEULE FOIS : le client doit sauvegarder id + code + phrase.
    // `id` = identifiant privé du client (à conserver, sert à initier des matchs).
    return res.status(201).json({ id: profilId, code, phrase });
  } catch (e) {
    await client.query('rollback');
    console.error('création profil échouée:', e.message); // jamais les données sensibles
    return res.status(500).json({ erreur: 'création impossible' });
  } finally {
    client.release();
  }
});

module.exports = router;
