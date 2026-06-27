'use strict';

// =====================================================================
//  reveal.js
//  Logique PURE du déblocage à l'aveugle. Aucune base, aucun réseau.
//
//  RÈGLES INVIOLABLES :
//   - On ne révèle un item que si LES DEUX ont tapé "envie".
//   - Un "passe" n'est JAMAIS renvoyé, ni directement ni indirectement.
//   - On ne renvoie JAMAIS la progression de l'autre (combien de cartes
//     vues, terminé ou non). => un item non révélé reste AMBIGU : l'autre
//     a passé OU n'a pas encore décidé. C'est cette ambiguïté qui protège.
// =====================================================================

// Items mutuellement désirés dans une session.
// `choixParProfil` = { profilId1: {itemId: 'envie'|'passe', ...},
//                      profilId2: {itemId: 'envie'|'passe', ...} }
function calculerRevelations(choixParProfil) {
  const ids = Object.keys(choixParProfil);
  if (ids.length < 2) return [];
  const A = choixParProfil[ids[0]];
  const B = choixParProfil[ids[1]];

  const reveles = [];
  for (const item of Object.keys(A)) {
    if (A[item] === 'envie' && B[item] === 'envie') {
      reveles.push(item); // mutuel : sûr à montrer aux deux
    }
  }
  return reveles;
}

// Vue d'un appelant : UNIQUEMENT ce qu'il a le droit de voir.
// On ne lui transmet jamais les choix de l'autre.
function vuePourAppelant(choixParProfil, idAppelant) {
  return {
    revelations: calculerRevelations(choixParProfil),
    // Volontairement : aucune info sur l'autre (ni choix, ni avancement).
  };
}

// Sélection des prochaines cartes à proposer.
//  - `pool` : le jeu de cartes (opt-in frais, ex. [{id, categorie}, ...]).
//  - `dejaChoisis` : Set des item_id déjà tranchés par l'appelant.
//  - `categoriesExclues` : Set des catégories sous limite dure de L'UN OU
//     L'AUTRE participant. On n'y propose jamais de carte.
function prochainesCartes(pool, dejaChoisis, categoriesExclues, n = 5) {
  return pool
    .filter((c) => !categoriesExclues.has(c.categorie))
    .filter((c) => !dejaChoisis.has(c.id))
    .slice(0, n);
}

// Construit l'ensemble des catégories à exclure pour une paire, à partir
// des limites dures de chacun. Les limites servent UNIQUEMENT à exclure,
// jamais à révéler.
function categoriesExcluesPour(limitesA = [], limitesB = []) {
  return new Set([...limitesA, ...limitesB]);
}

module.exports = {
  calculerRevelations,
  vuePourAppelant,
  prochainesCartes,
  categoriesExcluesPour,
};
