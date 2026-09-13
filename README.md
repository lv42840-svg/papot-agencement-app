# PAPOT AGENCEMENT

Application interne PAPOT AGENCEMENT, V1 en développement.

Le cahier des charges officiel Google Drive reste la source de vérité fonctionnelle. Le dépôt Git contient le code correspondant à l'état réellement développé ainsi que des notes techniques datées. En cas de contradiction, les décisions AGE les plus récentes du cahier des charges priment.

## Etat actuel du socle

Le projet comprend désormais :

- application Next.js / React / TypeScript ;
- application Windows Electron avec installeur NSIS ;
- PostgreSQL comme source de vérité métier ;
- SQLite/local uniquement pour cache, configuration, état appareil et travaux de synchronisation ;
- authentification PAPOT par session serveur ;
- droits READ / WRITE par module et droits spéciaux ;
- Nextcloud pour documents, synchronisation et mécanismes partagés ;
- transport mobile asynchrone avec paquets signés, idempotence et ACK en cours de validation production ;
- shell desktop lavande avec navigation latérale ;
- premiers modules Entrées, Commercial, Chantiers et Planning encore en phase de reprise/audit métier.

## Architecture retenue

PostgreSQL reste la source de vérité des données métier V1 et ne doit jamais être exposé directement sur Internet.

Nextcloud reste l'autorité pour les documents et les mécanismes de fichiers/versions/verrous partagés. Un relais HTTPS minimal peut être utilisé pour le transport mobile extérieur, sans exposer PostgreSQL ni transformer ce relais en API générale du back-office PAPOT.

Chaque poste Windows possède un `device_id` stable. L'identité métier doit venir du **vrai utilisateur PAPOT connecté**, et non d'un utilisateur codé dans la configuration du poste.

## Audit fonctionnel en cours

La reprise module par module a validé :

- le socle Electron / PostgreSQL / Nextcloud ;
- le principe connexion / utilisateurs / droits ;
- l'architecture visuelle PC existante ;
- la fusion future de Capture et Entrées autour d'une seule source PostgreSQL.

Les corrections techniques identifiées doivent être appliquées avant de considérer ces blocs terminés côté code :

1. configurer et vérifier PostgreSQL au premier lancement installé ;
2. supprimer l'utilisateur PAPOT lié au poste et utiliser la session authentifiée ;
3. utiliser `user_id + device_id` pour verrous et historique ;
4. appliquer les droits côté serveur sur toutes les API desktop ;
5. terminer l'administration utilisateurs/droits ;
6. fusionner l'ancien `/capture` et le module Entrées autour du même modèle PostgreSQL.

Voir `docs/audit-status-2026-09-13.md` pour le gel courant des décisions récentes.

## Devis / facturation natifs

Le flux cible est désormais :

`Capture -> Client -> Affaire -> Chiffrage -> Devis -> Confirmation -> Chantier -> Production -> TS -> Facture -> Paiement`

OBAT n'est plus une dépendance centrale pour les nouveaux devis/factures PAPOT. Les anciens documents OBAT restent historiques.

Le moteur documentaire Word -> données -> PDF a été validé en preuve de concept avec de vrais devis/factures. Son intégration production sera faite au moment où la reprise des modules arrivera naturellement au module Devis.

## Stack technique

- Next.js App Router + React + TypeScript strict
- Electron + electron-builder / NSIS
- PostgreSQL via `pg`
- SQLite local pour état non métier partagé
- migrations SQL explicites
- authentification locale par mot de passe `scrypt` et session serveur en cookie HttpOnly
- Zod pour les validations d'entrée
- Nextcloud WebDAV / OCS pour fichiers et synchronisation
- Vitest pour les tests
- ESLint + Prettier

## Démarrage développement

Prérequis : Node.js 22+ et PostgreSQL.

```bash
cp .env.example .env.local
npm install
npm run db:migrate
npm run db:bootstrap
npm run dev
```

Avant `db:bootstrap`, remplacer les valeurs `BOOTSTRAP_ADMIN_*` par de vraies valeurs locales. Elles ne doivent jamais être commitées.

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
- sessions stockées côté serveur sous forme de hash de jeton ;
- requêtes SQL paramétrées ;
- validation des entrées API ;
- contrôles de droits côté serveur obligatoires ;
- secrets Nextcloud/PostgreSQL installés localement via stockage chiffré Windows ;
- PostgreSQL jamais publié directement sur Internet.
