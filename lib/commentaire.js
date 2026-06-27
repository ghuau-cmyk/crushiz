'use strict';

// =====================================================================
//  commentaire.js
//  Transforme un résultat de match (palier + catégories communes) en un
//  court texte chaleureux.
//
//  Conçu BANQUE D'ABORD : tout le texte est pré-écrit et contrôlé. Le
//  générateur ne fait qu'assembler des phrases sûres. Le passage par IA
//  est optionnel et ne reçoit QUE des libellés larges déjà sûrs.
//
//  RÈGLES INVIOLABLES (encodées ici, ne jamais assouplir) :
//   - Ne parler QUE des points communs positifs, par catégorie large.
//   - Jamais de divergence, jamais d'acte précis nommé.
//   - Toujours "vous deux", jamais "toi tu...".
//   - Jamais de verdict sur le couple ("(in)compatibles", prédiction).
// =====================================================================

// Message fixe quand il n'y a pas assez de terrain commun. INVARIANT :
// identique à chaque fois, aucun score, aucun thème (anti-inférence).
const MESSAGE_SOUS_SEUIL =
  "Pas encore assez d'éléments en commun pour une vraie comparaison. " +
  "Répondez chacun à quelques questions de plus, et retentez !";

// Amorces selon le palier. Plusieurs variantes pour éviter la répétition.
const AMORCES = {
  faible: [
    "Peu de terrain commun sur le papier — mais c'est souvent là que les conversations les plus curieuses démarrent.",
    "Vos réponses se croisent peu pour l'instant : de quoi avoir plein de choses à vous découvrir.",
    "Pas les mêmes envies au premier regard. Parfois, c'est tout l'intérêt d'en parler.",
  ],
  moyen: [
    "Il y a de jolies choses en commun entre vous, et de quoi explorer le reste.",
    "Un bel équilibre : des points d'accord, et de la place pour la découverte.",
    "Vous vous rejoignez sur de vrais points — un bon point de départ.",
  ],
  fort: [
    "Vous vous accordez sur beaucoup de choses — l'alchimie est là.",
    "Beaucoup d'envies partagées entre vous : ça matche fort.",
    "Vous êtes clairement sur la même longueur d'onde.",
  ],
};

// Phrases par catégorie. Volontairement LARGES (jamais d'acte précis).
const PHRASES_CATEGORIE = {
  sensoriel_doux: [
    "Vous partagez une sensualité qui aime prendre son temps.",
    "Il y a entre vous un goût commun pour la douceur.",
  ],
  pouvoir_controle: [
    "Vous avez une belle complicité dans le jeu de qui mène et qui suit.",
    "Le jeu des rôles semble couler de source entre vous.",
  ],
  sensations_intenses: [
    "Vous partagez la même curiosité pour monter en intensité.",
    "L'envie d'aller chercher des sensations plus fortes vous rassemble.",
  ],
};

const MAX_CATEGORIES = 2; // plafond : évite la liste à rallonge et limite l'exposition

// ---------------------------------------------------------------------
//  Petit générateur pseudo-aléatoire À GRAINE : un même `seed` (ex. l'id
//  de session) donne toujours le même commentaire => stable au
//  rafraîchissement, varié d'une session à l'autre.
// ---------------------------------------------------------------------
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
function pickN(rng, arr, n) {
  const copie = arr.slice();
  for (let i = copie.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie.slice(0, n);
}

// ---------------------------------------------------------------------
//  Génération depuis la banque (aucune dépendance, aucun appel réseau)
// ---------------------------------------------------------------------
function genererCommentaire(palier, categoriesCommunes = [], opts = {}) {
  const rng = mulberry32(hashSeed(String(opts.seed ?? Math.random())));

  const morceaux = [pick(rng, AMORCES[palier] || AMORCES.moyen)];

  const categoriesConnues = categoriesCommunes.filter((c) => PHRASES_CATEGORIE[c]);
  for (const cat of pickN(rng, categoriesConnues, MAX_CATEGORIES)) {
    morceaux.push(pick(rng, PHRASES_CATEGORIE[cat]));
  }
  return morceaux.join(' ');
}

// =====================================================================
//  Passage IA OPTIONNEL (pour varier le style). Ne reçoit que le palier
//  et des libellés de catégorie LARGES — jamais de réponse, jamais de
//  divergence. Le pire qu'il pourrait "fuiter" est déjà sûr à montrer.
// =====================================================================
const LIBELLES_CATEGORIE = {
  sensoriel_doux: 'douceur et sensualité (au sens large)',
  pouvoir_controle: 'jeu de qui mène et qui suit (au sens large)',
  sensations_intenses: "goût pour l'intensité (au sens large)",
};

const SYSTEME_IA = `Tu rédiges un court commentaire (2 à 3 phrases) pour une app de
compatibilité, ton décontracté et bienveillant, en français, tutoiement, au "vous deux".

TU REÇOIS UNIQUEMENT : un palier ("faible", "moyen" ou "fort") et une liste de
points communs déjà filtrés (uniquement des choses que LES DEUX partagent, en
termes larges). Tu n'as ni les réponses individuelles, ni les désaccords. N'invente
jamais ce que tu n'as pas.

RÈGLES ABSOLUES :
- Jamais de verdict sur le couple ou la relation (pas de "(in)compatibles", pas de
  "faits l'un pour l'autre", aucune prédiction d'avenir).
- Jamais mentionner un désaccord ou une absence de correspondance, même par allusion.
- Jamais attribuer une envie à une seule personne : toujours "vous deux".
- Rester au niveau large fourni, ne nomme aucun acte précis.
- Jamais juger ni moraliser.

SI palier "faible" : reconnais avec légèreté le peu de recouvrement, présente-le comme
un point de départ pour discuter, jamais comme un échec.
SI palier "moyen" ou "fort" : mets en valeur les points communs avec chaleur.`;

function construirePromptIA(palier, categoriesCommunes = []) {
  const points = categoriesCommunes
    .map((c) => LIBELLES_CATEGORIE[c])
    .filter(Boolean);
  const user =
    `Palier : ${palier}\n` +
    `Points communs : ${points.length ? points.join(', ') : 'aucun en particulier'}`;
  return { system: SYSTEME_IA, user };
}

module.exports = {
  genererCommentaire,
  construirePromptIA,
  MESSAGE_SOUS_SEUIL,
};
