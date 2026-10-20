# Déploiement Cloud Run

Lire d'abord [la migration de sécurité](../SECURITY-MIGRATION.md). L'ancienne procédure par code partagé est retirée : son code était public.

Construire l'image depuis la racine du dépôt avec `render-service/cloudbuild.yaml`. Configurer les secrets et l'origine exacte de la nouvelle révision, puis déployer **sans trafic** pour la recette.

Conserver les réglages du pilote : une instance maximum, minimum zéro, concurrence limitée, CPU disponible pendant les rendus asynchrones. Les jobs et sessions sont en mémoire. Ne pas déplacer le trafic avant d'avoir validé les deux comptes, les données, les exports et les nouveaux accès Make.

Ne pas désactiver GitHub Pages ni rendre le dépôt privé avant la migration des clients et de leurs sauvegardes.
