# Pennylane API V2: lecture seule, zone de préparation

## État et limites

Cette branche prépare un adaptateur, sans installation, sans connexion active, sans
déploiement et **sans effet sur les données métier**. Aucun accès au jeton réel
n'est nécessaire pour exécuter les tests unitaires.

- La clé testée précédemment identifiait **PAPOT LIBERAL**, avec seulement
  `billing_subscriptions:all`. Elle est insuffisante pour lire les quatre ressources.
  Elle a été divulguée par e-mail et doit être révoquée / remplacée.
- Il faut une **nouvelle clé** propre à la société, disposant au minimum des scopes
  `suppliers:readonly`, `supplier_invoices:readonly`,
  `customers:readonly`, `customer_invoices:readonly`.
- La fonctionnalité reste désactivée par défaut, même après fusion éventuelle.
  Aucun CRON ni synchronisation automatique n'est encore installé.
- L'API PAPOT n'expose que les compteurs d'import et la date, jamais les documents
  bruts, les informations bancaires, le jeton ou la réponse `/me`.
- Aucune création ou mise à jour de fournisseur, client ou facture dans Pennylane,
  aucune modification des objets métier PAPOT.

## Configuration (VPS seulement, pas dans GitHub)

Dans `deploy/agencement-web/.env` du VPS, une fois les accès obtenus :

```dotenv
PAPOT_PENNYLANE_ENABLED=false
PAPOT_PENNYLANE_EXPECTED_COMPANY=PAPOT LIBERAL
PAPOT_PENNYLANE_API_TOKEN=<nouveau-jeton-prive>
```

Le fichier ci-dessus est exclu de Git. Ne jamais coller le jeton dans une PR,
une conversation, un ticket, une capture ou une commande de journalisation.

Après validation fonctionnelle et une sauvegarde PostgreSQL, passer explicitement
`PAPOT_PENNYLANE_ENABLED=true` lors d'un futur déploiement autorisé.

## Parcours de synchronisation

1. Un administrateur PAPOT ayant `settings:WRITE` et la permission de gestion
   des droits appelle `POST /api/desktop/pennylane` avec JSON
   `{"action":"SYNC"}`. Aucun appel ne part tant que le drapeau est faux.
2. `GET /me` confirme la société exacte attendue avant le moindre import.
3. Les quatre lectures GET suivent la pagination opaque par `cursor`, avec
   contrôle de réponse, limite de pages et déduplication par ID Pennylane.
4. En cas de 401 / 403 / 429 / erreur réseau ou pagination incomplète, aucun
   nouvel instantané n'est publié. Un échec ne se transforme jamais en zéro.
5. Un seul commit PostgreSQL remplace **tous les quatre** instantanés de staging
   par les nouveaux et enregistre leurs dates et compteurs. Les anciennes lignes
   ne restent pas en doublon. Une erreur SQL annule toute la transaction.
6. `GET /api/desktop/pennylane` (droit `settings:READ`) affiche seulement
   les métadonnées. Aucune vue financière PAPOT ne consomme ces données pour
   l'instant. Un jeu de données absent n'est pas affiché comme zéro.

**Attention :** un instantané complet d'une API paginée peut être incohérent si
des modifications simultanées interviennent chez le fournisseur. Avant
l'activation en production, confronter les totaux et préparer une réconciliation
sur les factures créées/modifiées pendant l'import. Les associations aux
chantiers, les avoirs, les acomptes, les statuts et l'analytique doivent
être validés explicitement avant de brancher le calcul de rentabilité.

## Architecture

- `src/lib/pennylane/config.ts` : drapeau + configuration serveur.
- `client.ts` : GET `/me` et quatre lectures paginées avec erreurs neutres.
- `sync.ts` : construit un jeu complet ou échoue sans résultat partiel.
- `store.ts` : publication transactionnelle dans
  `papot_pennylane_staging` et `papot_pennylane_sync_state`.
- `src/app/api/desktop/pennylane/route.ts` : administration protégée.
- `src/lib/server-db/migrations.ts` : schéma PostgreSQL version 17.

## Tests

```bash
npm ci
npm test -- tests/pennylane-readonly.test.ts
PAPOT_DATABASE_URL=postgresql://... npm test -- tests/pennylane-staging.integration.test.ts
npm run lint
npm run typecheck
npm run format:check
npm run build
```

Les tests d'intégration PostgreSQL sont ignorés si
`PAPOT_DATABASE_URL` n'est pas renseigné. La CI doit également les
exécuter avec une instance PostgreSQL de test.

Référence Pennylane :
https://pennylane.readme.io/docs/using-cursor-based-pagination
