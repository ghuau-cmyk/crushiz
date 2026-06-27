'use strict';

// =====================================================================
//  chiffrement.js
//  Cœur cryptographique de l'application.
//
//  - Réponses des profils : chiffrées en AES-256-GCM (chiffrement
//    authentifié : confidentialité + détection de toute altération).
//  - Codes & phrases de récupération : stockés en HMAC-SHA256 avec un
//    pepper serveur. On ne stocke jamais la valeur en clair.
//
//  N'utilise QUE le module `crypto` natif de Node : zéro dépendance
//  externe = zéro risque de chaîne d'approvisionnement sur la crypto.
//
//  Secrets attendus en variables d'environnement (JAMAIS dans le code,
//  JAMAIS dans Git, présents UNIQUEMENT sur la production) :
//    CLE_CHIFFREMENT_V1  : 32 octets encodés en base64  (clé AES-256)
//    PEPPER_HMAC         : >= 32 octets encodés en base64
//
//  Pour générer des secrets neufs (à faire une fois, pour la prod) :
//    node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// =====================================================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------
//  Chargement et validation des secrets — on échoue tout de suite si un
//  secret manque ou est mal dimensionné (fail-closed : jamais démarrer
//  une appli de données sensibles avec une crypto incomplète).
// ---------------------------------------------------------------------

function chargerCle(nomVar, octetsAttendus) {
  const brut = process.env[nomVar];
  if (!brut) {
    throw new Error(`Secret manquant : variable d'environnement ${nomVar} non définie.`);
  }
  const cle = Buffer.from(brut, 'base64');
  if (cle.length !== octetsAttendus) {
    throw new Error(
      `Secret invalide : ${nomVar} fait ${cle.length} octets, ${octetsAttendus} attendus.`
    );
  }
  return cle;
}

// Registre de clés indexé par version => permet la rotation future sans
// casser les anciens profils (cf. colonne version_cle du schéma).
const CLES = {
  1: chargerCle('CLE_CHIFFREMENT_V1', 32),
};
const VERSION_CLE_COURANTE = 1;

const PEPPER = (() => {
  const brut = process.env.PEPPER_HMAC;
  if (!brut) throw new Error("Secret manquant : PEPPER_HMAC non défini.");
  const p = Buffer.from(brut, 'base64');
  if (p.length < 32) throw new Error('PEPPER_HMAC trop court (>= 32 octets requis).');
  return p;
})();

// =====================================================================
//  Chiffrement des profils  (AES-256-GCM)
// =====================================================================

// Chiffre l'objet `reponses` (sérialisé en JSON).
// Retourne les trois morceaux à stocker tels quels dans la table profils,
// plus la version de clé utilisée.
function chiffrerProfil(reponses) {
  const cle = CLES[VERSION_CLE_COURANTE];
  const iv = crypto.randomBytes(12); // 96 bits : taille standard pour GCM, UNIQUE par profil
  const cipher = crypto.createCipheriv('aes-256-gcm', cle, iv);

  const clair = Buffer.from(JSON.stringify(reponses), 'utf8');
  const chiffre = Buffer.concat([cipher.update(clair), cipher.final()]);
  const authTag = cipher.getAuthTag(); // 16 octets : sceau anti-altération

  return {
    reponsesChiffrees: chiffre,
    iv,
    authTag,
    versionCle: VERSION_CLE_COURANTE,
  };
}

// Déchiffre un profil. `versionCle` vient de la ligne en base.
// Si les données ont été altérées (ou la mauvaise clé), final() LÈVE une
// erreur : on ne renvoie jamais de données silencieusement corrompues.
function dechiffrerProfil({ reponsesChiffrees, iv, authTag, versionCle }) {
  const cle = CLES[versionCle];
  if (!cle) throw new Error(`Version de clé inconnue : ${versionCle}`);

  const decipher = crypto.createDecipheriv('aes-256-gcm', cle, iv);
  decipher.setAuthTag(authTag);

  const clair = Buffer.concat([decipher.update(reponsesChiffrees), decipher.final()]);
  return JSON.parse(clair.toString('utf8'));
}

// =====================================================================
//  HMAC  (codes & phrases de récupération)
// =====================================================================

// `domaine` sépare les usages : un même texte produit un HMAC différent
// selon qu'il s'agit d'un jeton ou d'une phrase. Évite toute collision
// de sens entre les deux tables.
function hmac(valeur, domaine) {
  return crypto
    .createHmac('sha256', PEPPER)
    .update(domaine + ':' + valeur, 'utf8')
    .digest(); // Buffer de 32 octets, à stocker en bytea
}

const hmacJeton = (jeton) => hmac(jeton, 'jeton');
const hmacPhrase = (phrase) => hmac(phrase, 'phrase');

// Comparaison à temps constant — à utiliser pour toute vérification
// applicative d'un HMAC (la recherche par index en base, elle, est gérée
// par PostgreSQL).
function hmacEgaux(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// =====================================================================
//  Génération du jeton partageable (le "code")
// =====================================================================

// Base32 façon Crockford : sans I, L, O, U (caractères ambigus à l'oral
// et à la lecture). 10 octets aléatoires => 16 caractères, ~80 bits.
function base32(buf) {
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let bits = 0, value = 0, out = '';
  for (const octet of buf) {
    value = (value << 8) | octet;
    bits += 8;
    while (bits >= 5) {
      out += A[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += A[(value << (5 - bits)) & 31];
  return out;
}

function genererJeton() {
  return base32(crypto.randomBytes(10));
}

// =====================================================================
//  Génération de la phrase de récupération (type "seed phrase")
// =====================================================================

// Liste de mots chargée depuis un fichier (un mot par ligne). Utiliser
// une liste type BIP39 française (2048 mots) pour une bonne entropie.
const CHEMIN_MOTS = path.join(__dirname, 'mots_recuperation.txt');
let MOTS = null;
function chargerMots() {
  if (MOTS) return MOTS;
  const contenu = fs.readFileSync(CHEMIN_MOTS, 'utf8');
  MOTS = contenu.split('\n').map((m) => m.trim()).filter(Boolean);
  if (MOTS.length < 1024) {
    throw new Error('Liste de mots trop courte pour une phrase de récupération sûre.');
  }
  return MOTS;
}

// 6 mots => entropie élevée (ex. ~66 bits avec une liste de 2048 mots).
// crypto.randomInt fournit un tirage uniforme (non biaisé).
function genererPhraseRecuperation(nbMots = 6) {
  const mots = chargerMots();
  const tirage = [];
  for (let i = 0; i < nbMots; i++) {
    tirage.push(mots[crypto.randomInt(0, mots.length)]);
  }
  return tirage.join(' ');
}

module.exports = {
  chiffrerProfil,
  dechiffrerProfil,
  hmacJeton,
  hmacPhrase,
  hmacEgaux,
  genererJeton,
  genererPhraseRecuperation,
};
