'use strict';

// =====================================================================
//  correspondance.js
//  Logique de match PURE : aucune base, aucun réseau, aucun secret.
//  Entrée : deux objets de réponses DÉJÀ DÉCHIFFRÉS (en mémoire).
//  Sortie : un palier ('faible'|'moyen'|'fort') + les catégories communes.
//
//  On ne renvoie JAMAIS le score précis (paliers = anti-inférence), ni la
//  moindre réponse individuelle, ni la moindre divergence.
// =====================================================================

// ---------------------------------------------------------------------
//  Scores élémentaires
// ---------------------------------------------------------------------

// Ressemblance sur une échelle ordonnée : proches = compatibles.
function scoreRessemblance(a, b, options) {
  const ia = options.indexOf(a), ib = options.indexOf(b);
  if (ia < 0 || ib < 0) return null;                 // réponse absente -> non comparable
  return 1 - Math.abs(ia - ib) / (options.length - 1);
}

// Complémentarité : opposés = compatibles (ex. initiative, rôle, direction
// donner/recevoir). Les valeurs "joker" s'accordent avec tout.
function scoreComplementarite(a, b, conf) {
  if (a == null || b == null) return null;
  const jokers = conf.jokers || [];
  if (jokers.includes(a) || jokers.includes(b)) return 0.8;
  if (a !== b) return 1.0;                            // directions opposées = complémentaires
  return 0.3;                                         // mêmes rôles affirmés = friction
}

// Branche (oui/curieux/non/limite) : ne compte QUE si les deux sont
// positifs. Un "non", une "limite" ou une absence => pas de terrain commun,
// donc EXCLU du calcul (ce n'est PAS une pénalité : les branches sont
// optionnelles, ne pas les partager est neutre).
function scoreBranche(a, b) {
  const positif = (x) => x === 'oui' || x === 'curieux';
  if (!positif(a) || !positif(b)) return null;
  if (a === 'oui' && b === 'oui') return 1.0;
  if (a === 'curieux' && b === 'curieux') return 0.6;
  return 0.7;                                         // oui + curieux
}

function palier(score) {
  if (score < 0.45) return 'faible';
  if (score < 0.70) return 'moyen';
  return 'fort';
}

// ---------------------------------------------------------------------
//  Calcul principal
//  `bareme` : tableau décrivant chaque question (voir BAREME_EXEMPLE).
//  `opts.seuil` : nb minimal de questions communes pour un résultat fiable.
// ---------------------------------------------------------------------
function calculerMatch(repA, repB, bareme, opts = {}) {
  const SEUIL = opts.seuil ?? 8;

  let sommePoids = 0, sommeScore = 0, communs = 0;
  const matchsParCategorie = {};        // catégorie -> nb de correspondances mutuelles
  const categoriesLimite = new Set();   // catégories touchées par une limite dure

  for (const q of bareme) {
    const a = repA[q.id], b = repB[q.id];

    // Limite dure d'un côté ou de l'autre : catégorie bannie, on saute.
    if (a === 'limite' || b === 'limite') {
      if (q.categorie) categoriesLimite.add(q.categorie);
      continue;
    }

    let s = null;
    if (q.type === 'ressemblance')          s = scoreRessemblance(a, b, q.options);
    else if (q.type === 'complementarite')  s = scoreComplementarite(a, b, q);
    else if (q.type === 'branche')          s = scoreBranche(a, b);

    if (s === null) continue;             // pas de terrain commun sur cette question

    const poids = q.poids ?? 1;
    sommePoids += poids;
    sommeScore += poids * s;
    communs   += 1;

    // Comptage par catégorie (pour le commentaire). Seuil 0.6 = vraie proximité.
    if (q.categorie && s >= 0.6) {
      matchsParCategorie[q.categorie] = (matchsParCategorie[q.categorie] || 0) + 1;
    }
  }

  // Pas assez de terrain commun => aucun verdict (et message générique côté API).
  if (communs < SEUIL) {
    return { statut: 'sous_seuil' };
  }

  const score = sommeScore / sommePoids;  // 0..1, jamais renvoyé tel quel

  // Règle de granularité : une catégorie n'est mentionnable qu'à partir de
  // 2 correspondances mutuelles, et jamais si elle touche une limite dure.
  const categoriesCommunes = Object.entries(matchsParCategorie)
    .filter(([cat, n]) => n >= 2 && !categoriesLimite.has(cat))
    .map(([cat]) => cat);

  return {
    statut: 'ok',
    palier: palier(score),
    categoriesCommunes,
  };
}

// ---------------------------------------------------------------------
//  Exemple de barème (extrait). Le barème complet EST le questionnaire :
//  une entrée par question du tronc et par item de branche.
// ---------------------------------------------------------------------
const BAREME_EXEMPLE = [
  // --- Tronc commun (posé à tous, porte la compatibilité de base) ---
  { id: 'q1', type: 'ressemblance', options: ['discret','tranquille','present','tout_le_temps'] },
  { id: 'q2', type: 'ressemblance', options: ['tendresse','equilibre','physique'] },
  { id: 'q6', type: 'complementarite', jokers: ['tour_de_role','peu_importe'] }, // initiative
  { id: 'q7', type: 'ressemblance', options: ['matin','apres_midi','soir','nimporte'], poids: 0.3 },
  { id: 'q9', type: 'complementarite', jokers: ['alterner'] },                    // rôle
  { id: 'q11', type: 'ressemblance', options: ['lent','depend','direct'] },

  // --- Branche "sensations" (ne compte que si les deux ont exploré) ---
  { id: 'b_sens_sensoriel', type: 'branche', categorie: 'sensoriel_doux' },
  { id: 'b_sens_consignes', type: 'branche', categorie: 'pouvoir_controle' },
  { id: 'b_sens_consignes_dir', type: 'complementarite', jokers: ['les_deux'], categorie: 'pouvoir_controle' },
  { id: 'b_sens_fessee', type: 'branche', categorie: 'sensations_intenses' },
  { id: 'b_sens_fessee_dir', type: 'complementarite', jokers: ['les_deux'], categorie: 'sensations_intenses' },
  { id: 'b_sens_attache', type: 'branche', categorie: 'pouvoir_controle' },
];

module.exports = { calculerMatch, palier, BAREME_EXEMPLE };
