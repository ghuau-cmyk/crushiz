-- =====================================================================
-- Migration 002 : sessions de match (double consentement)
--
-- Principes encodés :
--   1. Un match ne calcule RIEN tant que les deux consentements ne sont
--      pas réunis (consentement_a ET consentement_b).
--   2. On ne stocke QUE le résultat agrégé : le palier et les catégories
--      communes. Jamais les réponses, jamais le score précis.
--   3. on delete cascade : la suppression d'un profil efface ses sessions.
-- =====================================================================

create table sessions_match (
  id                  uuid        primary key default gen_random_uuid(),
  profil_a            uuid        not null references profils(id) on delete cascade, -- l'initiateur
  profil_b            uuid        not null references profils(id) on delete cascade, -- le destinataire
  consentement_a      boolean     not null default true,   -- l'initiateur consent en lançant
  consentement_b      boolean     not null default false,  -- le destinataire doit accepter
  statut              text        not null default 'en_attente'
                      check (statut in ('en_attente','accepte','refuse','expire')),

  -- Résultat agrégé, écrit seulement une fois les deux consentements réunis :
  resultat_palier     text        check (resultat_palier in ('faible','moyen','fort')),
  resultat_categories jsonb,

  cree_le             timestamptz not null default now(),
  maj_le              timestamptz not null default now(),

  check (profil_a <> profil_b)   -- pas de match avec soi-même
);

-- Lookup rapide des demandes en attente pour un destinataire :
create index idx_sessions_b_attente
  on sessions_match(profil_b) where statut = 'en_attente';

-- Réutilise le trigger maj_le défini en migration 001 :
create trigger trg_sessions_maj
  before update on sessions_match
  for each row execute function touch_maj_le();
