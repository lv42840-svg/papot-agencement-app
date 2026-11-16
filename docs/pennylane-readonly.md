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

## Configuration de la clé depuis les Paramètres administrateur

La clé API Pennylane se saisit dans **Paramètres → Pennylane** depuis
l'application, uniquement pour un compte administrateur
(`canManagePermissions`). Le formulaire peut :

- enregistrer ou remplacer le jeton via un champ masqué ;
- afficher seulement « enregistrée » ou « non configurée » (jamais le jeton) ;
- tester la société avec GET `/me` puis les quatre permissions avec
  quatre GET `?limit=1` ; aucun document n'est importé lors du test ;
- supprimer le jeton et les données isolées précédemment importées.

Le jeton ne peut pas être récupéré par le navigateur après enregistrement.
Il est chiffré **AES-256-GCM** avec un nonce aléatoire et un tag
d'authenticité avant stockage dans `papot_pennylane_connection`.
Le secret de chiffrement reste **uniquement sur le VPS**, jamais en base
ni dans GitHub. Le test conserve seulement les noms des ressources et
leurs résultats d'autorisation.

Dans le fichier privé `deploy/agencement-web/.env` **sur le VPS**,
un opérateur installe une clé indépendante :

```dotenv
PAPOT_PENNYLANE_ENABLED=false
PAPOT_PENNYLANE_ENCRYPTION_KEY=<cle-aleatoire-base64-de-32-octets>
```

Pour générer cette clé directement sur le VPS : `openssl rand -base64 32`.
Ne jamais utiliser cette valeur dans les tests, la PR, une capture ou
un message. **Sauvegarder le secret de chiffrement dans un gestionnaire
de secrets sécurisé** : sa perte rend impossible le déchiffrement des
jetons précédemment enregistrés. Sa rotation demande un réenregistrement
du jeton depuis l'interface.

Aucune synchronisation n'est déclenchée à l'enregistrement ou au test.
Même avec un jeton enregistré, l'import reste **désactivé** par défaut.
Le drapeau `PAPOT_PENNYLANE_ENABLED=true` devra être activé sur le VPS
après une validation séparée et un déploiement explicitement autorisé.
La clé précédemment envoyée par e-mail étant exposée, demander sa
révocation et en générer une nouvelle avec les droits de lecture.

## Sécurité du formulaire

- Routes `/api/admin/pennylane` GET/POST protégées par
  `requirePermissionAdministrator`.
- Les opérations POST exigent JSON strict et un en-tête Origin de même
  domaine, pour bloquer les envois cross-origin.
- Réponses `private, no-store`, sans clé ni extrait de clé.
- Le contrôle des droits utilise GET seulement, et ne divulgue pas
  de réponses brutes de Pennylane.
- La suppression efface également les instantanés de staging, sans
  toucher aux données métier PAPOT.

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
- `src/lib/server-db/migrations.ts` : schémas PostgreSQL versions 17 et 18.\n- `src/lib/pennylane/connection.ts` et `secret-crypto.ts` : stockage et chiffrement du jeton.\n- `src/app/settings/pennylane/page.tsx` : page administrateur.\n- `src/app/api/admin/pennylane/route.ts` : sauvegarde, test et suppression du jeton.

## Tests

```bash
npm ci
npm test -- tests/pennylane-readonly.test.ts tests/pennylane-crypto.test.ts tests/pennylane-admin-route.test.ts
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
