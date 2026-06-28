-- =====================================================================
-- Migration 001 : schéma initial
-- PostgreSQL 14+
--
-- Principes de sécurité encodés dans ce schéma :
--   1. Les réponses ne sont JAMAIS stockées en clair : un seul blob
--      chiffré AES-256-GCM par profil. Le rapprochement (match) se fait
--      EN MÉMOIRE applicative après déchiffrement, jamais via SQL.
--   2. Les tables `codes` et `recuperation` ne stockent que des HMAC.
--      Un dump de la base, seul, ne révèle aucun code ni aucune phrase
--      utilisable : la clé de chiffrement ET le pepper HMAC vivent en
--      variables d'environnement, hors de la base.
--   3. `on delete cascade` : supprimer un profil efface d'un coup son
--      code et sa récupération => suppression RGPD propre et atomique.
-- =====================================================================

-- gen_random_uuid() est natif depuis PostgreSQL 13 : aucune extension requise.

-- ---------------------------------------------------------------------
-- profils : réponses chiffrées, AUCUNE donnée personnelle
-- ---------------------------------------------------------------------
create table profils (
  id                 uuid        primary key default gen_random_uuid(),
  reponses_chiffrees bytea       not null,                 -- JSON des réponses, chiffré
  iv                 bytea       not null,                 -- vecteur d'init., unique par ligne
  auth_tag           bytea       not null,                 -- tag d'authentification GCM
  version_cle        smallint    not null default 1,       -- pour la rotation de clé
  version_questions  smallint    not null default 1,       -- version de l'arbre de questions
  cree_le            timestamptz not null default now(),
  maj_le             timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- codes : jeton partageable -> profil. Régénérable.
-- Un seul code actif par profil : la régénération remplace l'ancien.
-- ---------------------------------------------------------------------
create table codes (
  id         uuid        primary key default gen_random_uuid(),
  profil_id  uuid        not null references profils(id) on delete cascade,
  jeton_hmac bytea       not null,                          -- HMAC-SHA256(jeton, pepper)
  cree_le    timestamptz not null default now()
);

create unique index idx_codes_jeton_hmac on codes(jeton_hmac);  -- lookup à la saisie d'un code
create unique index idx_codes_un_par_profil on codes(profil_id); -- un seul code actif / profil

-- ---------------------------------------------------------------------
-- recuperation : phrase de récupération GÉNÉRÉE (haute entropie),
-- type "seed phrase". Permet de retrouver son profil sur un autre
-- appareil. Stockée en HMAC, jamais en clair.
-- ---------------------------------------------------------------------
create table recuperation (
  id          uuid        primary key default gen_random_uuid(),
  profil_id   uuid        not null references profils(id) on delete cascade,
  phrase_hmac bytea       not null,                          -- HMAC-SHA256(phrase, pepper)
  cree_le     timestamptz not null default now()
);

create unique index idx_recup_phrase_hmac on recuperation(phrase_hmac); -- lookup à la récupération
create unique index idx_recup_un_par_profil on recuperation(profil_id);

-- ---------------------------------------------------------------------
-- Met à jour profils.maj_le automatiquement à chaque modification
-- ---------------------------------------------------------------------
create or replace function touch_maj_le() returns trigger as $$
begin
  new.maj_le = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_profils_maj
  before update on profils
  for each row execute function touch_maj_le();
