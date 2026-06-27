-- =====================================================================
-- Migration 003 : déblocage à l'aveugle (choix scellés)
--
-- Chaque personne tape "envie" ou "passe" sur des cartes, en privé. Le
-- serveur ne révèle un item QUE si les deux ont tapé "envie". Un "passe"
-- n'est jamais montré ; les non-matchs ne sont jamais listés.
--
-- IMPORTANT : ces choix sont un opt-in FRAIS, fait dans l'instant. Ils ne
-- rouvrent jamais les réponses du questionnaire (pas d'exposition
-- unilatérale). La table ne sert qu'au rapprochement en direct.
-- =====================================================================

create table reveal_choix (
  id         uuid        primary key default gen_random_uuid(),
  session_id uuid        not null references sessions_match(id) on delete cascade,
  profil_id  uuid        not null references profils(id) on delete cascade,
  item_id    text        not null,
  choix      text        not null check (choix in ('envie','passe')),
  cree_le    timestamptz not null default now(),

  unique (session_id, profil_id, item_id)   -- un seul choix par personne / item / session
);

-- Pour retrouver les deux choix d'un même item dans une session :
create index idx_reveal_session_item on reveal_choix(session_id, item_id);
