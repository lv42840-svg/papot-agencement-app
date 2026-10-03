# Devis natif — marquage envoyé et relance

Cette brique ajoute le passage opérationnel d'un devis natif de `DRAFT` à `SENT` sans implémenter encore l'envoi d'e-mail ni la génération PDF finale.

Règles appliquées :

- l'utilisateur ouvre le devis depuis le suivi de l'affaire ;
- l'action « Marquer envoyé » exige une date de relance ;
- le devis conserve sa propre date de relance ;
- l'affaire passe en `En attente` avec la même date ;
- à l'échéance, le suivi commercial et l'affichage du devis indiquent `À relancer` ;
- plusieurs devis d'une même affaire conservent chacun leur propre échéance d'affichage ;
- l'opération nécessite les droits d'écriture sur Devis et Commercial.

L'envoi électronique, la numérotation finale et le PDF sont hors périmètre de cette brique.
