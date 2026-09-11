# PAPOT AGENCEMENT

Fondations de la V1 de l'application interne PAPOT AGENCEMENT.

## Lot 1

Ce lot installe le socle technique et le premier vertical slice réel :

`Connexion -> interface responsive -> Nouvelle capture -> PostgreSQL -> confirmation -> boîte À qualifier`

Le code est une application web responsive PWA à code commun PC/smartphone. PostgreSQL reste derrière la couche applicative et ne doit jamais être publié directement sur Internet. Le stockage documentaire Nextcloud est volontairement préparé pour les lots suivants mais aucun faux connecteur n'est simulé dans ce lot.

## Stack technique

- Next.js App Router + React + TypeScript strict
- PostgreSQL via `pg`
- migrations SQL explicites
- authentification locale par mot de passe `scrypt` et session serveur en cookie HttpOnly
- Zod pour les validations d'entrée
- Vitest pour les tests
- ESLint + Prettier
- PWA avec manifest et service worker minimal

Le mécanisme d'authentification est isolé dans `src/lib/auth` pour rester remplaçable si l'infrastructure PAPOT impose ultérieurement un fournisseur d'identité différent.

## Démarrage local

Prérequis : Node.js 22+ et PostgreSQL.

```bash
cp .env.example .env.local
npm install
npm run db:migrate
npm run db:bootstrap
npm run dev
```

Avant `db:bootstrap`, remplacer toutes les valeurs `BOOTSTRAP_ADMIN_*` par de vraies valeurs locales. Elles ne doivent jamais être commitées.

## Base de données

`DATABASE_URL` doit viser PostgreSQL sur le réseau interne du serveur PAPOT. En production, PostgreSQL ne doit pas écouter directement sur Internet. L'accès distant à l'application doit arriver sur la couche web HTTPS uniquement.

Migration initiale : `db/migrations/001_initial.sql`.

Elle crée :

- utilisateurs et sessions ;
- droits par utilisateur et par module ;
- permissions spéciales extensibles ;
- préférence de couleur d'accent par utilisateur ;
- référentiel de tags de Capture, désactivable sans perte historique ;
- captures et relation multi-tags ;
- identifiant idempotent `client_request_id` contre les doubles envois.

## Authentification et premier utilisateur

Aucun mot de passe n'est fourni dans Git. Le script `npm run db:bootstrap` crée ou met à jour le premier administrateur depuis les variables d'environnement et lui donne le droit `capture:WRITE`.

Les droits sont stockés individuellement, et non déduits du nom d'une personne. Le champ d'administration des permissions permet de représenter le responsable autorisé sans codage en dur de son identité.

## Capture, périmètre de ce lot

Le premier parcours implémenté est la création d'une **piste commerciale** :

- nom libre obligatoire ;
- responsable obligatoire, prérempli avec l'utilisateur connecté ;
- priorité `Normale` par défaut ou `Urgent` ;
- date `À faire pour le` facultative ;
- tags actifs facultatifs et multi-sélectionnables ;
- auteur et horodatage automatiques ;
- état initial `TO_QUALIFY` ;
- protection idempotente contre le double envoi ;
- confirmation `Capture envoyée` ;
- visibilité immédiate sur l'accueil dans `À qualifier`.

Le flux hors connexion complet, les photos/Nextcloud, la qualification détaillée, les clients/chantiers récents et les autres types de Capture sont volontairement reportés. Le service worker et la séparation repository/API/UI évitent de devoir refaire le socle quand ils seront ajoutés.

## Design system V1

- mode clair ;
- Inter avec pile de repli système ;
- thème lavande par défaut ;
- palette d'accent prédéfinie enregistrée en base ;
- couleurs d'état indépendantes du thème personnel ;
- navigation latérale PC et navigation basse mobile ;
- tableaux compacts qui deviennent des cartes sur smartphone ;
- bordures fines, relief discret, arrondis modérés ;
- badges texte + couleur ;
- skeleton loader ;
- confirmation discrète sans modale inutile.

L'asset de maquette Drive reste une référence visuelle et n'est pas recopié pixel par pixel.

## Qualité

Commandes attendues avant merge :

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Le workflow `.github/workflows/ci.yml` rejoue ces contrôles sur les Pull Requests.

## Sécurité

- aucun secret dans le dépôt ;
- mots de passe hachés avec `scrypt` et sel aléatoire ;
- cookies de session HttpOnly, SameSite=Lax et Secure en production ;
- sessions stockées côté serveur sous forme de hash de jeton ;
- requêtes SQL paramétrées ;
- validation Zod des entrées API ;
- contrôles de droits côté serveur avant écriture.

## Éléments volontairement reportés

- stockage Nextcloud et photos ;
- file locale IndexedDB et synchronisation hors connexion de Capture ;
- qualification métier complète et délai 48 h ouvrées ;
- clients/chantiers et raccourcis récents ;
- `Mes tâches` complet ;
- Planning et autres modules fonctionnels.
