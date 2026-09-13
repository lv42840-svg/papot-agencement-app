# Devis natif — moteur métier V1

La fondation métier du Devis natif est volontairement indépendante de l'interface et du stockage partagé afin de tester les calculs avant de brancher les écrans.

Règles couvertes dans cette tranche :

- numéro final `D-AAAA-NNNN` ;
- validité par défaut de 30 jours ;
- quantité directe ou formule légère conservée en mémoire interne ;
- calcul sécurisé sans `eval` ;
- montants en centimes ;
- remises séquentielles ligne, section, global ;
- HT, TVA et TTC ;
- statuts métier de base.

Le module Devis reste absent du mobile. L'API et le stockage Nextcloud seront raccordés dans la tranche suivante.
