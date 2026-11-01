# Sauvegarde et restauration AGENCEMENT

Le script `scripts/ops/backup.py` associe un export PostgreSQL au répertoire de fichiers métier. Il arrête `agencement-web` via Docker Compose pendant la copie et le redémarre dans un bloc de nettoyage, y compris en cas d'échec. Il refuse les liens symboliques et vérifie chaque fichier par SHA-256 avant restauration. Un arrêt brutal du système peut empêcher le redémarrage automatique : vérifier alors `docker compose ps`.

## Prérequis et périmètre

- Python 3, client PostgreSQL compatible avec le serveur (`pg_dump`, `pg_restore`, `psql`), Docker Compose.
- Exporter `PAPOT_DATABASE_URL` dans l'environnement depuis la configuration sécurisée. L'adresse PostgreSQL doit être joignable depuis la machine exécutant le script (le nom interne Docker `papot-postgres` n'est pas nécessairement résolu sur l'hôte). Ne jamais mettre le mot de passe dans l'historique de commande.
- Racine métier habituelle : `/srv/agencement`. Arrêter également tout autre programme écrivant dans cette base ou ce répertoire (client desktop, imports, accès réseau). Le script n'arrête que le service web indiqué.
- Conserver séparément et de manière chiffrée la configuration `.env`, Caddy et les modèles personnalisés situés hors de la racine métier. Le script ne copie pas les secrets de déploiement.
- Conserver le commit Git correspondant. La sauvegarde contient des données confidentielles : accès réservé, copie chiffrée hors du VPS, contrôle des échecs et politique de rétention à configurer sur l'infrastructure.

## Sauvegarder

Depuis le dépôt sur le VPS, avec l'environnement PostgreSQL préparé :

```bash
python3 scripts/ops/backup.py backup \
  --compose-file deploy/agencement-web/docker-compose.yml \
  --files /srv/agencement \
  --destination /srv/papot-backups/agencement-2026-10-31 \
  --revision "$(git rev-parse HEAD)"
```

La destination doit être nouvelle et extérieure au répertoire sauvegardé. Un export incomplet n'est pas publié comme sauvegarde terminée. Vérifier le redémarrage du service et copier la sauvegarde hors du VPS.

## Restaurer d'abord dans un environnement isolé

Créer une base vide et un répertoire vide, préparer `PAPOT_DATABASE_URL` vers cette base de test puis :

```bash
python3 scripts/ops/backup.py restore \
  --source /srv/papot-backups/agencement-2026-10-31 \
  --files /srv/agencement-restauration-test
```

La restauration refuse une base ou un répertoire déjà remplis. Elle ne supprime jamais les données de production. Si la base est restaurée mais que le déplacement final des fichiers échoue, garder l'application arrêtée et recommencer dans une autre cible vide après diagnostic.

Avant une bascule réelle : démarrer le commit sauvegardé avec cette base et ces fichiers, sans SMTP ni synchronisation externe ; tester connexion, ouverture de devis/PDF/pièces jointes, chantier, heures et facturation ; comparer les nombres d'enregistrements et les derniers éléments saisis. Valider ensuite explicitement la bascule de configuration. Aucun script n'effectue automatiquement cette bascule.

## Validation continue et limite

La CI teste un aller-retour PostgreSQL + fichier, le refus de cible non vide et le rejet d'une sauvegarde altérée. Ce test ne prouve pas que les sauvegardes du VPS sont programmées, copiées hors site ou restaurables : faire et consigner un exercice sur une copie réelle avant de considérer la reprise validée.
