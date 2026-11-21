# Recette PAPOT : étiquetage des données TEST

Cette fonctionnalité sert à **repérer** les dossiers d'essai dans l'application.
Elle ne crée pas de base de données séparée et **n'efface rien automatiquement**.

## Préparer une nouvelle recette

1. Dans **Commercial > Affaires > Nouvelle affaire**, choisir un client fictif ou un
   client de recette, puis cocher **« Affaire de TEST »**.
2. Créer un devis depuis cette affaire : son marqueur TEST est automatiquement hérité.
3. Si l'affaire est confirmée puis lancée en chantier, le chantier hérite aussi
   du marqueur TEST.
4. Dans les listes **Affaires**, **Devis** et **Chantiers**, cocher
   **« Afficher uniquement les ... TEST »** pour les retrouver.
5. Sur chaque fiche, **Marquer comme donnée TEST** ou
   **Retirer le marquage TEST** permet de corriger le classement des dossiers
   existants. Les changements de marqueur d'affaire et chantier sont historisés.

## Limites importantes

- Le marqueur TEST est un repère, **pas une isolation fonctionnelle** : les
  heures, commandes, plannings, PDF et suivis produits par un dossier marqué TEST
  peuvent rester dans les modules ordinaires. Vérifier chaque action externe.
- Marquer une affaire déjà créée n'applique **pas rétroactivement** l'étiquette
  aux devis et chantiers existants. Chaque dossier possède son bouton.
- Les données anciennes sans marqueur restent considérées comme
  **non test**. Aucun classement automatique par nom, client ou date.
- Le bac à sable de facturation **Essais supprimables** possède son propre
  registre isolé et sa remise à zéro. Il n'efface pas les affaires, devis ou
  chantiers marqués TEST.
- Les devis finalisés, les numéros de factures, les PDF officiels, les archives
  réglementaires et les données Pennylane ne doivent jamais être supprimés
  simplement parce qu'un dossier porte ce marqueur.

## Nettoyage futur

Après la recette, établir un inventaire nominatif des affaires/devis/chantiers
marqués TEST, recenser toutes leurs dépendances (heures, commandes, factures,
documents, photos, planning, synchronisations) et obtenir un accord explicite
sur les éléments à retirer.

Effectuer une sauvegarde complète vérifiée avant toute purge ciblée, procéder
par dépendances et garder un journal de ce qui a réellement été supprimé.
L'étiquetage **ne constitue pas** une autorisation de suppression.

## Exemple de scénario

Créer une affaire TEST, préparer un devis, confirmer l'affaire, lancer un chantier,
puis tester les projets de factures et les documents du bac à sable.
À la fin, vider uniquement les factures simulées depuis **Mode TEST**.
Conserver les autres dossiers marqués TEST pour l'inventaire du nettoyage.
