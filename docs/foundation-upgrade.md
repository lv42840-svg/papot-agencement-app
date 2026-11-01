# Installation et recette des sauvegardes et du stockage

## Sauvegardes : installation sur le VPS

Ces fichiers préparent le service ; leur présence dans Git ne l'active pas. L'installation réelle et le choix d'une destination externe restent à faire sur le VPS.

1. Installer `restic`, `postgresql-client` compatible avec la base, Python 3 et Docker Compose.
2. Remplir `/etc/papot-agencement-backup.env` à partir de `deploy/agencement-web/backup/backup.env.example`. La connexion PostgreSQL doit être joignable depuis l'hôte : ne pas publier le port de la base sur Internet pour cela. Réserver ce fichier à root, mode 600.
3. Créer `/etc/papot-agencement-restic-password`, mode 600, avec un secret long et aléatoire. Conserver une copie de récupération de ce secret en dehors du VPS. Préparer l'accès à la destination distante (clé SSH dédiée ou identifiants du stockage), puis initialiser le dépôt Restic avec ce même environnement. Le script refuse de poursuivre si le dépôt externe n'est pas accessible.
4. Installer les fichiers depuis le dépôt :

```bash
sudo install -m 700 scripts/ops/scheduled-backup.sh /usr/local/sbin/papot-agencement-backup
sudo install -m 644 deploy/agencement-web/backup/papot-agencement-backup.service /etc/systemd/system/
sudo install -m 644 deploy/agencement-web/backup/papot-agencement-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start papot-agencement-backup.service
sudo systemctl status papot-agencement-backup.service --no-pager
sudo journalctl -u papot-agencement-backup.service -n 40 --no-pager
```

Vérifier la copie distante et l'état sain de l'application après cette exécution avant d'activer la récurrence :

```bash
sudo systemctl enable --now papot-agencement-backup.timer
sudo systemctl list-timers papot-agencement-backup.timer
```

Le service s'exécute vers 02h30 heure de Paris avec un décalage aléatoire maximal de 10 minutes. Il arrête le web pendant l'export cohérent puis le redémarre avant l'envoi Restic, chiffré. Il ne supprime aucune sauvegarde. Prévoir une politique de rétention et une surveillance des échecs via les journaux existants de l'infrastructure ; aucune notification n'est envoyée par ce code. Arrêter également les autres éventuels processus écrivant dans la base ou les fichiers.

Pour tester une copie hors site : utiliser `restic restore` vers un dossier isolé, puis suivre `docs/backup-restore.md` avec une base vide et un dossier de fichiers vide. Ouvrir les dernières pièces jointes, les heures et un export de paie. Ne pas qualifier l'installation de validée avant cet exercice sur les données réelles. Sauvegarder séparément les configurations et secrets hors racine métier.

## Stockage des heures et coûts

Les heures réalisées, heures SAV/FG, coûts mensuels et historiques associés sont séparés du bloc d'état dans `papot_state_rows`, indexés par domaine, collection et clé de ligne. Les journaux conservent leur ordre. La première lecture déplace les tableaux sous transaction et conserve le bloc initial dans `papot_state_migration_backups`. Un échec annule toute la transaction. Les lignes inchangées ne sont pas réécrites.

Cette étape réduit le volume des écritures, mais conserve les lectures de collection et le verrou de module pour la compatibilité des opérations existantes. Elle ne constitue pas encore une API entièrement paginée ni un verrou par salarié. Les devis, commandes et factures ne sont pas encore migrés.

Déployer après sauvegarde complète, avec arrêt de toutes les anciennes instances. Ne jamais mélanger anciens et nouveaux exécutables : un ancien code ne connaît pas ce stockage. Un retour à une version antérieure à cette migration exige une restauration de la base ET des fichiers sauvegardés, puis redémarrage de cette version ; un simple retour du code ne suffit pas. Aucune table de reprise n'est purgée automatiquement.

## Horaires conservés avec les heures

Les nouveaux enregistrements d'heures conservent l'horaire qui sert à répartir les semaines entre mois pour la valorisation des coûts. Une correction de la même ligne réutilise cet horaire. Les heures existantes sans cette information sont figées à leur première lecture avec l'horaire actuellement connu : cela ne reconstitue pas les horaires historiques qui n'avaient jamais été enregistrés. Les taux de paie peuvent toujours être corrigés intentionnellement avec historique. Les calculs de paie déjà validés restent fondés sur leurs versions figées.
