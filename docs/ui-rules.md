# PAPOT AGENCEMENT — Règles UI fixes

Ces règles sont obligatoires pour l’interface fonctionnelle de PAPOT AGENCEMENT. Elles évitent les tailles décidées écran par écran et garantissent une densité stable sur les postes de travail.

## Typographie

L’interface fonctionnelle utilise exactement trois niveaux :

- titre principal de page : **18 px** ;
- titre de section / sous-titre structurel : **15 px** ;
- texte courant, labels, boutons, champs, sélecteurs, messages et libellés : **13 px**.

Aucune autre taille ne doit être introduite dans l’interface fonctionnelle sans décision explicite. Le bloc de marque / logo PAPOT est une exception graphique et ne relève pas de cette règle.

## Contrôles

- hauteur standard des champs, listes déroulantes et boutons : **36 px** ;
- bouton icône carré : **32 x 32 px** ;
- case à cocher / bouton radio : **16 x 16 px** ;
- les cases à cocher ne doivent jamais hériter de la largeur ou de la hauteur des champs texte.

## Administration des utilisateurs

La page `Utilisateurs et droits` utilise une grille déterministe :

- modules : 6 colonnes à partir de 1600 px, 4 colonnes entre 1200 et 1599 px, 2 colonnes entre 800 et 1199 px, 1 colonne sous 800 px ;
- droits spéciaux : 4 colonnes à partir de 1200 px, 2 colonnes entre 800 et 1199 px, 1 colonne sous 800 px ;
- le bouton de création d’utilisateur et le bouton d’enregistrement du profil gardent une largeur de bouton, ils ne remplissent pas arbitrairement une colonne entière ;
- le champ de réinitialisation du mot de passe est plafonné à 620 px sur grand écran ;
- les clés techniques de modules ou permissions (`commercial`, `planning`, `purchases`, etc.) ne doivent jamais être affichées à l’utilisateur.

## Règle de développement

Les tailles de l’interface doivent être prises dans `src/app/ui-rules.css`. Un nouvel écran doit réutiliser ces valeurs plutôt que définir ses propres tailles locales.
