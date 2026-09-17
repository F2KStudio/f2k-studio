# Déploiement Cloud Run

Le déploiement utilise le dossier `f2k-studio` comme contexte Docker.

## Pré-requis

- Projet Google Cloud avec facturation activée.
- CLI `gcloud` installée et authentifiée.
- Région recommandée : `europe-west1` ou région proche des utilisateurs.

## Préparer le projet

```bash
gcloud config set project PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
gcloud artifacts repositories create f2k-studio \
  --repository-format=docker \
  --location=europe-west1
```

## Créer les secrets

Générer deux valeurs aléatoires différentes d’au moins 32 octets, puis créer :

```bash
printf %s 'RANDOM_RENDER_KEY' | gcloud secrets create f2k-render-api-key --data-file=-
printf %s 'RANDOM_SESSION_SECRET' | gcloud secrets create f2k-session-secret --data-file=-
```

L’empreinte du code d’accès actuel `F2K-STUDIO-26!` est :

```text
37f8ed32fec54c684bf2007c292b0b4a236478895ca639287e823b1c31a3ae4b
```

## Construire l’image

Depuis le dossier `f2k-studio` :

```bash
IMAGE=europe-west1-docker.pkg.dev/PROJECT_ID/f2k-studio/video-renderer:latest
gcloud builds submit \
  --config render-service/cloudbuild.yaml \
  --substitutions _IMAGE=$IMAGE \
  .
```

## Déployer

```bash
gcloud run deploy f2k-studio \
  --image $IMAGE \
  --region europe-west1 \
  --allow-unauthenticated \
  --cpu 2 \
  --memory 4Gi \
  --concurrency 10 \
  --min-instances 0 \
  --max-instances 1 \
  --timeout 3600 \
  --no-cpu-throttling \
  --set-env-vars F2K_ACCESS_CODE_HASH=37f8ed32fec54c684bf2007c292b0b4a236478895ca639287e823b1c31a3ae4b,F2K_RETENTION_MS=86400000 \
  --set-secrets F2K_RENDER_API_KEY=f2k-render-api-key:latest,F2K_SESSION_SECRET=f2k-session-secret:latest
```

`--no-cpu-throttling` est nécessaire pour le prototype de file en mémoire : le rendu continue après la réponse HTTP 202. `--max-instances 1` garantit que le suivi et le téléchargement arrivent sur l’unique instance qui possède le job. Cette architecture est adaptée au pilote avec deux utilisateurs, mais devra migrer vers Cloud Tasks/Firestore ou le serveur de l’entreprise avant une montée en charge.

## Contrôler les coûts

- Conserver `min-instances=0` et `max-instances=1`.
- Créer des alertes budgétaires.
- Activer un plafond de dépenses Cloud Run si disponible sur le compte.
- Surveiller les premières vidéos dans Cloud Logging.
- Ne pas augmenter CPU, mémoire ou nombre d’instances avant mesure réelle.

## Premier test

1. Ouvrir l’URL Cloud Run.
2. Saisir le code `F2K-STUDIO-26!`.
3. Créer un visuel simple.
4. Exporter uniquement une vidéo Story.
5. Vérifier le suivi du job, le téléchargement MP4 et les logs.
6. Tester ensuite Post, puis seulement les exports multiples.

## Limite importante

Le webhook PhotoRoom est encore présent dans le HTML. La page ne doit pas être annoncée publiquement tant que le détourage n’est pas également passé derrière une route serveur protégée.
