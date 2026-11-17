# Explorateur partagé PAPOT

Explorateur dédié à `https://srv.papot.app`, pour tous les utilisateurs actifs
d’Agencement et de Concept. Le choix de l’application sert uniquement à vérifier
les identifiants ; tous les comptes voient la même racine `/srv`.

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
symboliques ne sont pas exposés. Les fichiers réguliers non masqués lisibles sous
`/srv` sont accessibles à **tous** les comptes des deux applications ; déplacer
les sauvegardes sensibles hors de cet espace partagé si elles s’y trouvent.
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
