# Devis natif — fondation métier

Cette première brique du module Devis natif verrouille les règles de calcul avant l'interface et le stockage partagé.

Elle couvre :

- numérotation finale au format `D-AAAA-NNNN` ;
- validité par défaut de 30 jours ;
- quantités simples ou calculées à partir d'une formule légère (`2+6+4+9`, `4*2`, parenthèses et division) sans `eval` ;
- conservation interne de la formule lorsqu'une quantité est calculée ;
- montants financiers en centimes ;
- remise de ligne et moteur de remises séquentielles ligne → section → global ;
- calcul HT, TVA et TTC ;
- statuts métier de base `DRAFT`, `SENT`, `ACCEPTED`, `REJECTED`, `CANCELLED`.

Cette note décrit une étape historique du domaine Devis. Le stockage et les API actifs sont désormais gérés directement par PAPOT côté serveur.
