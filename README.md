# Sukiss — app de compatibilité

Cœur applicatif. Déployé sur le serveur OVH (aaPanel), derrière un verrou d'accès,
sur le domaine `crushiz.com`.

## Structure

```
server.js        Point d'entrée Express (M1 : /health ; endpoints métier en Phase 2)
db.js            Pool PostgreSQL (DATABASE_URL)
lib/             Modules métier (crypto, scoring, reveal, commentaire) + liste BIP39
migrations/      001/002/003 — schéma de la base compat
scripts/migrate.js   Lanceur de migrations idempotent
.env.example     Modèle de config (le vrai .env vit UNIQUEMENT sur le serveur)
```

## Règles d'or

1. **Secrets et données réelles : production UNIQUEMENT.** Le vrai `.env` (clé, pepper)
   n'est jamais committé ni copié hors du serveur.
2. **`.env` dans `.gitignore` avant tout commit.**
3. **Commiter souvent.**
4. **Ne jamais affaiblir les règles inviolables** en tête de `correspondance.js`,
   `commentaire.js`, `reveal.js`.

## Lancer (sur le serveur)

```bash
npm install
node scripts/migrate.js   # applique les migrations (pgcrypto pré-créée en superuser)
npm start                 # démarre le serveur sur 127.0.0.1:$PORT
```

## Endpoints

- `GET /health` — santé du service (sans base ni secrets).
- `GET /health/db` — vérifie la connexion PostgreSQL.
