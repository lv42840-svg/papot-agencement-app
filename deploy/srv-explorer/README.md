# Explorateur partagé PAPOT

Explorateur dédié à `https://srv.papot.app` pour les comptes des deux
applications. L'administrateur de PAPOT SRV choisit les droits de chaque compte
par dossier et sous-dossier dans l'onglet **Paramètres**. Les droits sont refusés
par défaut, y compris pour les documents accessibles par URL directe.

## Accès et administration

- **Administrateur unique** : une identité précise `SRV_ADMIN_SOURCE` +
  `SRV_ADMIN_USER_ID` (ID immuable délivré par l'application d'origine).
  L'onglet Paramètres n'existe que pour cette identité. Le serveur vérifie
  aussi ce droit pour chaque API d'administration.
- **Comptes** : l'onglet liste les utilisateurs qui se sont déjà connectés
  à SRV. Un collaborateur doit se connecter une première fois pour apparaître
  dans la sélection. Il ne voit rien avant l'attribution de droits.
- **Droits** : Lecture pour parcourir/voir/télécharger, Dépôt pour créer un dossier
  ou ajouter un fichier. Le sous-dossier hérite du parent sauf règle explicite
  plus précise ; le refus est également possible. On peut n'autoriser qu'un
  sous-dossier au sein d'une arborescence refusée.
- Chaque appel d'API liste, télécharge, prévisualise ou dépose avec les droits
  en vigueur. La révocation d'un droit bloque les requêtes suivantes.
- **Persistance** : `/opt/papot/srv-explorer/state` (monté en `/state`) ne
  réside pas dans `/srv` ; il n'est pas exposé par l'explorateur. À intégrer
  aux sauvegardes du VPS ainsi que l'environnement Docker, de façon protégée.
- Pas de chmod/chown récursif des répertoires de travail. Les permissions
  Linux continuent à s'appliquer indépendamment des règles de SRV.
- Un seul processus SRV doit écrire ce fichier ; pas de réplication concurrente.

### Prérequis AVANT le premier déploiement avec les droits par dossier

1. Relever **sans communiquer d'identifiants ni de cookies** l'ID du compte
   administrateur choisi (via une réponse authentifiée `/api/auth/identity`
   de son application). Ne pas prendre le nom affiché pour un identifiant stable.
2. Dans `deploy/srv-explorer/.env`, conserver la clé de session existante
   et ajouter `SRV_ADMIN_SOURCE=agencement` (ou `concept`) et
   `SRV_ADMIN_USER_ID=<id exact>`. Ne jamais partager `.env`.
3. Préparer le dossier de règles, sans toucher aux permissions existantes :

   ```bash
   sudo install -d -o 1000 -g 1000 -m 700 /opt/papot/srv-explorer/state
   ```

   Si `SRV_UID`/`SRV_GID` diffèrent de 1000, utiliser ces valeurs et
   vérifier que le dossier est accessible en écriture depuis le conteneur.

4. Sauvegarder également ce nouveau dossier de règles hors du VPS,
   avec les volumes existants. Avant la bascule, conserver un rollback
   `Dockerfile`/compose/image et tester les accès avec des comptes non-admin.
5. Ne déployer le nouveau conteneur **qu'après** la préparation et une
   sauvegarde vérifiée. Sinon, le service refusera de démarrer, ce qui évite
   une configuration par défaut trop permissive.

## Sauvegarde quotidienne des paramètres

La configuration `deploy/srv-explorer/.env` et le dossier d'autorisations
`/opt/papot/srv-explorer/state` sont copiés vers stockage distant en clair chaque jour
à 06h15 heure française, **si le timer est installé et activé**. Cette sauvegarde
est indépendante de la sauvegarde des documents et des bases PostgreSQL à 03h30.

Les fichiers sont rangés sous
`61_PAPOT_Production/BACKUP_VPS_PAPOT/CONFIGURATION_SRV/auto/<horodatage>/`
avec un marqueur `complete.txt` écrit seulement après vérification.
Le script utilise `--immutable` pour le fichier d'environnement et ne
supprime aucune sauvegarde distante. Les sauvegardes dans `/auto` s'accumulent
jusqu'à la mise en place d'une politique de rotation validée.

### Installation (après la fusion et la préparation du VPS)

```bash
cd ~/papot-agencement-app
sudo install -o root -g root -m 644 deploy/srv-explorer/systemd/papot-srv-config-backup.service /etc/systemd/system/
sudo install -o root -g root -m 644 deploy/srv-explorer/systemd/papot-srv-config-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now papot-srv-config-backup.timer
sudo systemctl start papot-srv-config-backup.service
sudo systemctl show papot-srv-config-backup.service -p Result -p ExecMainStatus
sudo journalctl -u papot-srv-config-backup.service -n 20 --no-pager
```

Vérifier le statut de `papot-backup-rclone-v2.timer` séparément : ce nouveau timer
ne le modifie pas. Le fichier `srv.env.txt` contient la clé de session SRV :
**ne jamais partager le répertoire stockage distant**, ni publier les URL, ni afficher
son contenu dans les journaux.

## Fonctionnalités

- Dossiers, fil d’Ariane, filtre par nom dans le dossier courant.
- Aperçus JPEG, PNG, GIF, WebP, PDF et texte ; précédent/suivant dans les aperçus.
- Téléchargement, création de dossiers, dépôt multiple et glisser-déposer (512 Mio
  par fichier par défaut). Les fichiers existants ne sont jamais remplacés.
- Aucun déplacement, renommage ou effacement des documents utilisés par les applications.
- Même stockage physique : aucun import ni duplication des fichiers existants.

## Connexion

Le service appelle le `POST /api/auth/login` existant de l’application choisie et
utilise son cookie pour appeler `GET /api/auth/identity` avant **chaque** opération.
Il ne lit pas les bases, ne copie pas les mots de passe et n’affaiblit pas les
limitations de tentatives existantes. Les deux applications doivent intégrer la
nouvelle route d’identité avant le démarrage.

Le cookie de l’explorateur est indépendant des cookies des applications, chiffré
avec AES-256-GCM, `HttpOnly`, `Secure`, `SameSite=Strict`, limité à 12 heures et au
seul hôte `srv.papot.app`. La session d’origine doit aussi rester valide. La
déconnexion révoque cette session côté application. Les changements de mot de
passe, désactivations et révocations sont donc pris en compte. Ce n’est pas une
connexion automatique entre sous-domaines : l’utilisateur saisit ses identifiants
habituels dans l’explorateur.

## Déployer

1. Fusionner puis déployer les deux modifications `/api/auth/identity` : celle de
   ce dépôt et celle de `papot-concept-app`. Vérifier qu’un appel sans cookie donne
   HTTP 401 sur les ports locaux 3002 et 3001, et non 404 ou 200.
2. Vérifier qu’une sauvegarde récente de `/srv` est disponible. Inspecter les
   dossiers présents et leurs permissions. Le service utilise UID/GID 1000, comme
   le conteneur Agencement. Ajuster les permissions seulement sur les dossiers
   de documents concernés si nécessaire ; ne pas lancer de `chmod` ou `chown -R`
   global sur `/srv`, qui pourrait contenir des données PostgreSQL.
3. Depuis la racine du dépôt sur le VPS :

   ```bash
   sudo bash deploy/srv-explorer/prepare.sh
   ```

   Le script crée une clé locale uniquement si `.env` n’existe pas. Il ne touche
   ni aux bases, ni aux fichiers, ni aux services existants. Si les noms de cookies
   des applications ont été personnalisés, ajouter les valeurs correspondantes
   `SRV_AGENCEMENT_COOKIE` / `SRV_CONCEPT_COOKIE` dans `deploy/srv-explorer/.env`.
   Pour un autre UID/GID, fournir `SRV_UID`/`SRV_GID` à Docker Compose via son option
   `--env-file` ou l’environnement de la commande (le `env_file` du service ne
   pilote pas l’interpolation Compose).

4. Créer dans la zone DNS de `papot.app` un enregistrement **A** nommé `srv` pointant
   vers l’IPv4 publique du VPS existant. Ajouter un AAAA seulement si l’IPv6 du VPS
   dessert effectivement Caddy. Aucune adresse IP n’est codée en dur ici.
5. Sauvegarder `/etc/caddy/Caddyfile`. Ajouter une seule fois le bloc de
   `deploy/srv-explorer/Caddyfile.snippet` à ce fichier, puis :

   ```bash
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

   Caddy fournit le certificat HTTPS. Il remplace le header d’adresse client
   avant de transmettre la requête. Le service n’écoute que `127.0.0.1:3003`.
   Les ports 3001/3002/3003 ne doivent pas être publiés sur Internet.

6. Ouvrir `https://srv.papot.app`. Tester une connexion de chaque application,
   consulter une photo et un PDF, déposer un petit fichier dans un dossier de
   test, vérifier sa présence via Y:, puis se déconnecter. Vérifier aussi qu’un
   compte désactivé ne peut pas ouvrir de fichier. Le lecteur Y: reste indépendant.

## Limites et protection du stockage

L’explorateur respecte les permissions Linux de son utilisateur. Les fichiers et
dossiers masqués (noms commençant par un point, dont `.env` et `.ssh`) et les liens
symboliques ne sont pas exposés. Les fichiers réguliers non masqués dans `/srv` sont exposés **seulement aux
comptes explicitement autorisés** par les règles de SRV. Les chemins directs
sont aussi soumis au contrôle. En revanche, le processus SRV possède toujours
des permissions Linux étendues : ses ACL applicatives ne remplacent pas une
isolation des volumes ou un contrôle indépendant des données confidentielles.
Les traversées de dossiers utilisent des descripteurs Linux et `O_NOFOLLOW` pour
empêcher les échappements par liens et les courses au changement de chemin.
Les dépôts sont publiés atomiquement sans écrasement, après transfert complet.
Les HTML/SVG et autres formats actifs sont téléchargés, jamais rendus en ligne.

Le filtre porte sur le dossier ouvert, pas sur une indexation récursive du serveur.
Les très grands dossiers sont limités à 5 000 éléments avec un avertissement.
Le service nécessite Linux et `/proc`, comme le VPS/Docker cible. Le healthcheck
contrôle le service ; il ne remplace pas les essais réels des deux connexions.
La désactivation d’un compte bloque les nouvelles requêtes ; un transfert déjà
autorisé et commencé peut se terminer.

## Vérifier le code

```bash
node --test services/srv-explorer/checks.mjs
```

Ces tests exercent le vrai serveur HTTP, avec des applications d’identité simulées
et un stockage temporaire. Ils couvrent les deux sources, les accès anonymes,
CSRF, verrouillages, révocation, traversées, liens, dépôts interrompus, collisions,
aperçus et requêtes partielles. Les essais sur les comptes de production restent
nécessaires après déploiement.

## Retour arrière

```bash
sudo docker compose -f deploy/srv-explorer/docker-compose.yml down
```

Retirer le seul bloc `srv.papot.app` de Caddy, valider puis recharger. Aucun fichier
de `/srv` n’est supprimé. Les routes d’identité peuvent rester installées : elles
ne retournent qu’une identité minimale à une session valide.
