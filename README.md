# PAPOT AGENCEMENT

Application interne PAPOT AGENCEMENT, V1 en développement.

Le cahier des charges officiel Google Drive reste la source de vérité fonctionnelle. Le dépôt Git contient le code correspondant à l'état réellement développé ainsi que des notes techniques datées. En cas de contradiction, les décisions AGE les plus récentes du cahier des charges priment.

## État actuel du socle

Le projet comprend désormais :

- application Next.js / React / TypeScript ;
- application Windows Electron avec installeur NSIS ;
- Nextcloud comme stockage partagé de l'application et des documents ;
- ressources JSON versionnées avec ETag, verrous et reprise de conflit pour les données partagées ;
- SQLite local uniquement pour cache, configuration, état appareil et travaux locaux de synchronisation ;
- authentification PAPOT par session serveur ;
- utilisateurs, droits READ / WRITE, droits spéciaux et sessions stockés dans l'état partagé Nextcloud ;
- shell desktop lavande avec navigation latérale ;
- premiers modules Entrées, Commercial, Chantiers et Planning en phase de reprise/audit métier.

## Architecture retenue

PAPOT AGENCEMENT ne dépend pas de PostgreSQL.

Nextcloud est l'autorité partagée pour les données de l'application et les documents. Les ressources métier sont stockées sous forme d'états versionnés ; les écritures utilisent les mécanismes WebDAV, ETag, verrouillage et détection de conflits du socle de synchronisation.

Chaque poste Windows possède un `device_id` stable. L'identité métier vient du **vrai utilisateur PAPOT connecté**, jamais d'un utilisateur codé dans la configuration du poste.

Le premier lancement demande uniquement les informations nécessaires au poste, au dossier partagé et au compte technique Nextcloud. Le premier administrateur PAPOT est ensuite créé dans l'application. Les utilisateurs suivants sont créés par un administrateur.

## Modules actuellement raccordés

- **Entrées** : stockage partagé Nextcloud, capture rapide, qualification, affectation, historique et pièces jointes ;
- **Commercial** : clients/affaires dans l'état partagé Nextcloud, documents dans Nextcloud ;
- **Chantiers** : ressources partagées Nextcloud et lancement depuis une affaire ;
- **Utilisateurs et droits** : comptes PAPOT, sessions, READ / WRITE et droits spéciaux dans Nextcloud ;
- **Planning** : socle de ressource partagée déjà présent, reprise fonctionnelle encore en cours.

L'ancienne route `/capture` redirige vers le module Entrées afin de conserver une seule entrée canonique.

## Devis / facturation natifs

Le flux cible est désormais :

`Capture -> Client -> Affaire -> Chiffrage -> Devis -> Confirmation -> Chantier -> Production -> TS -> Facture -> Paiement`

OBAT n'est plus une dépendance centrale pour les nouveaux devis/factures PAPOT. Les anciens documents OBAT restent historiques.

Le moteur documentaire Word -> données -> PDF a été validé en preuve de concept avec de vrais devis/factures. Son intégration production sera faite au moment où la reprise des modules arrivera naturellement au module Devis.

## Stack technique

- Next.js App Router + React + TypeScript strict
- Electron + electron-builder / NSIS
- Nextcloud WebDAV / OCS pour données partagées, fichiers et synchronisation
- SQLite local pour état non métier partagé
- authentification par mot de passe `scrypt` et session en cookie HttpOnly
- Zod pour les validations d'entrée
- Vitest pour les tests
- ESLint + Prettier

## Démarrage développement

Prérequis : Node.js 22+.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Pour lancer l'application Windows en développement :

```bash
npm run desktop:dev
```

Sous PowerShell lorsque l'exécution des scripts `npm.ps1` est bloquée :

```powershell
npm.cmd run desktop:dev
```

## Qualité

Commandes attendues avant fusion d'un lot fonctionnel :

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
- sessions stockées sous forme de hash de jeton dans l'état partagé ;
- validation des entrées API ;
- contrôles de droits côté serveur obligatoires ;
- secret technique Nextcloud stocké localement via le coffre sécurisé Windows ;
- ressource `AUTH` réservée au serveur et non modifiable via l'API générique de ressources partagées.
