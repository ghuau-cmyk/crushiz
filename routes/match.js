'use strict';

// =====================================================================
//  Endpoints de match — FRONTIÈRE DE CONFIANCE (point ⚠️ du projet).
//
//   - Rien n'est calculé tant que les DEUX consentements ne sont pas réunis.
//   - Les réponses sont déchiffrées EN MÉMOIRE uniquement, le temps du calcul ;
//     jamais journalisées, jamais mises en cache, jamais re-stockées.
//   - Seul l'AGRÉGAT (palier + catégories communes) est persisté.
//   - /match/initier est rate-limité (anti-sondage par faux profils).
// =====================================================================

const express = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const chiffrement = require('../lib/chiffrement');
const { calculerMatch, BAREME_EXEMPLE } = require('../lib/correspondance');
const { genererCommentaire, MESSAGE_SOUS_SEUIL } = require('../lib/commentaire');
const reveal = require('../lib/reveal');

const router = express.Router();

const estUuid = (s) =>
  typeof s === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// Anti-sondage : limite les initiations de match par IP.
const limiteInitier = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erreur: 'trop de tentatives, réessayez plus tard' },
});

// ---------------------------------------------------------------------
//  POST /match/initier  { profilId, code }
//  L'initiateur (profil_a) lance une demande vers le détenteur du `code`.
// ---------------------------------------------------------------------
router.post('/initier', limiteInitier, async (req, res) => {
  const { profilId, code } = req.body || {};
  if (!estUuid(profilId) || typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ erreur: 'profilId ou code invalide' });
  }
  try {
    const cible = await pool.query('select profil_id from codes where jeton_hmac = $1', [
      chiffrement.hmacJeton(code.trim()),
    ]);
    if (cible.rowCount === 0) return res.status(404).json({ erreur: 'code introuvable' });
    const profilB = cible.rows[0].profil_id;

    const moi = await pool.query('select 1 from profils where id = $1', [profilId]);
    if (moi.rowCount === 0) return res.status(404).json({ erreur: 'profil inconnu' });

    if (profilB === profilId) return res.status(400).json({ erreur: 'auto-match impossible' });

    const sess = await pool.query(
      `insert into sessions_match (profil_a, profil_b, consentement_a, statut)
       values ($1, $2, true, 'en_attente') returning id`,
      [profilId, profilB]
    );
    return res.status(201).json({ sessionId: sess.rows[0].id, statut: 'en_attente' });
  } catch (e) {
    console.error('initier match échoué:', e.message);
    return res.status(500).json({ erreur: 'initiation impossible' });
  }
});

// ---------------------------------------------------------------------
//  POST /match/:id/repondre  { profilId, accepte }
//  Le destinataire (profil_b) accepte ou refuse. Si accepte => calcul.
// ---------------------------------------------------------------------
router.post('/:id/repondre', async (req, res) => {
  const sessionId = req.params.id;
  const { profilId, accepte } = req.body || {};
  if (!estUuid(sessionId) || !estUuid(profilId) || typeof accepte !== 'boolean') {
    return res.status(400).json({ erreur: 'paramètres invalides' });
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const s = await client.query('select * from sessions_match where id = $1 for update', [
      sessionId,
    ]);
    if (s.rowCount === 0) {
      await client.query('rollback');
      return res.status(404).json({ erreur: 'session inconnue' });
    }
    const session = s.rows[0];

    if (session.profil_b !== profilId) {
      await client.query('rollback');
      return res.status(403).json({ erreur: 'non autorisé' });
    }
    if (session.statut !== 'en_attente') {
      await client.query('rollback');
      return res.status(409).json({ erreur: 'session déjà traitée' });
    }

    if (!accepte) {
      await client.query(
        "update sessions_match set consentement_b = false, statut = 'refuse' where id = $1",
        [sessionId]
      );
      await client.query('commit');
      return res.json({ statut: 'refuse' });
    }

    // --- DEUX CONSENTEMENTS RÉUNIS : calcul en mémoire ---
    const profs = await client.query(
      'select id, reponses_chiffrees, iv, auth_tag, version_cle from profils where id in ($1, $2)',
      [session.profil_a, session.profil_b]
    );
    if (profs.rowCount < 2) {
      await client.query('rollback');
      return res.status(409).json({ erreur: 'profil manquant' });
    }
    const parId = {};
    for (const r of profs.rows) parId[r.id] = r;

    // Déchiffrement EN MÉMOIRE uniquement (jamais journalisé, jamais persisté).
    const dechiffrer = (r) =>
      chiffrement.dechiffrerProfil({
        reponsesChiffrees: r.reponses_chiffrees,
        iv: r.iv,
        authTag: r.auth_tag,
        versionCle: r.version_cle,
      });
    const repA = dechiffrer(parId[session.profil_a]);
    const repB = dechiffrer(parId[session.profil_b]);

    const resultat = calculerMatch(repA, repB, BAREME_EXEMPLE);
    const palier = resultat.statut === 'ok' ? resultat.palier : null;
    const categories = resultat.statut === 'ok' ? resultat.categoriesCommunes : null;

    // Seul l'AGRÉGAT est persisté (jamais les réponses).
    await client.query(
      `update sessions_match
          set consentement_b = true, statut = 'accepte',
              resultat_palier = $2, resultat_categories = $3
        where id = $1`,
      [sessionId, palier, categories ? JSON.stringify(categories) : null]
    );
    await client.query('commit');

    const commentaire = palier
      ? genererCommentaire(palier, categories, { seed: sessionId })
      : MESSAGE_SOUS_SEUIL;
    return res.json({
      statut: 'accepte',
      palier,
      categoriesCommunes: categories || [],
      commentaire,
    });
  } catch (e) {
    await client.query('rollback');
    console.error('réponse match échouée:', e.message);
    return res.status(500).json({ erreur: 'traitement impossible' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------
//  GET /match/:id?profilId=...  — relire le statut / résultat agrégé.
// ---------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  const sessionId = req.params.id;
  const profilId = req.query.profilId;
  if (!estUuid(sessionId) || !estUuid(profilId)) {
    return res.status(400).json({ erreur: 'paramètres invalides' });
  }
  try {
    const s = await pool.query('select * from sessions_match where id = $1', [sessionId]);
    if (s.rowCount === 0) return res.status(404).json({ erreur: 'session inconnue' });
    const session = s.rows[0];
    if (session.profil_a !== profilId && session.profil_b !== profilId) {
      return res.status(403).json({ erreur: 'non autorisé' });
    }
    if (session.statut !== 'accepte') {
      return res.json({ statut: session.statut });
    }
    const palier = session.resultat_palier;
    const categories = session.resultat_categories || [];
    const commentaire = palier
      ? genererCommentaire(palier, categories, { seed: sessionId })
      : MESSAGE_SOUS_SEUIL;
    return res.json({ statut: 'accepte', palier, categoriesCommunes: categories, commentaire });
  } catch (e) {
    console.error('lecture match échouée:', e.message);
    return res.status(500).json({ erreur: 'lecture impossible' });
  }
});

// =====================================================================
//  Déblocage à l'aveugle (reveal) — au sein d'une session ACCEPTÉE.
//   - un item n'est révélé que si LES DEUX ont tapé "envie"
//   - un "passe" n'est jamais renvoyé ; aucune info sur l'avancement de l'autre
// =====================================================================

// Charge la session et vérifie que l'appelant en est un participant.
async function chargerSessionParticipant(sessionId, profilId) {
  const s = await pool.query(
    'select id, profil_a, profil_b, statut from sessions_match where id = $1',
    [sessionId]
  );
  if (s.rowCount === 0) return { code: 404, erreur: 'session inconnue' };
  const session = s.rows[0];
  if (session.profil_a !== profilId && session.profil_b !== profilId) {
    return { code: 403, erreur: 'non autorisé' };
  }
  return { session };
}

// Reconstruit { profilId: { itemId: choix } } depuis reveal_choix.
async function construireChoix(sessionId) {
  const r = await pool.query(
    'select profil_id, item_id, choix from reveal_choix where session_id = $1',
    [sessionId]
  );
  const parProfil = {};
  for (const row of r.rows) {
    if (!parProfil[row.profil_id]) parProfil[row.profil_id] = {};
    parProfil[row.profil_id][row.item_id] = row.choix;
  }
  return parProfil;
}

// POST /match/:id/reveal/choix  { profilId, itemId, choix }
router.post('/:id/reveal/choix', async (req, res) => {
  const sessionId = req.params.id;
  const { profilId, itemId, choix } = req.body || {};
  if (
    !estUuid(sessionId) ||
    !estUuid(profilId) ||
    typeof itemId !== 'string' ||
    !itemId.trim() ||
    (choix !== 'envie' && choix !== 'passe')
  ) {
    return res.status(400).json({ erreur: 'paramètres invalides' });
  }
  try {
    const { session, code, erreur } = await chargerSessionParticipant(sessionId, profilId);
    if (code) return res.status(code).json({ erreur });
    if (session.statut !== 'accepte') return res.status(409).json({ erreur: 'match non accepté' });

    await pool.query(
      `insert into reveal_choix (session_id, profil_id, item_id, choix)
       values ($1, $2, $3, $4)
       on conflict (session_id, profil_id, item_id) do update set choix = excluded.choix`,
      [sessionId, profilId, itemId.trim(), choix]
    );

    const choixParProfil = await construireChoix(sessionId);
    return res.json(reveal.vuePourAppelant(choixParProfil, profilId));
  } catch (e) {
    console.error('reveal choix échoué:', e.message);
    return res.status(500).json({ erreur: 'enregistrement impossible' });
  }
});

// GET /match/:id/reveal?profilId=...  — révélations mutuelles pour l'appelant.
router.get('/:id/reveal', async (req, res) => {
  const sessionId = req.params.id;
  const profilId = req.query.profilId;
  if (!estUuid(sessionId) || !estUuid(profilId)) {
    return res.status(400).json({ erreur: 'paramètres invalides' });
  }
  try {
    const { session, code, erreur } = await chargerSessionParticipant(sessionId, profilId);
    if (code) return res.status(code).json({ erreur });
    if (session.statut !== 'accepte') return res.status(409).json({ erreur: 'match non accepté' });
    const choixParProfil = await construireChoix(sessionId);
    return res.json(reveal.vuePourAppelant(choixParProfil, profilId));
  } catch (e) {
    console.error('reveal lecture échouée:', e.message);
    return res.status(500).json({ erreur: 'lecture impossible' });
  }
});

module.exports = router;
