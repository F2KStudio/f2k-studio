# F2K video renderer

Prototype portable Cloud Run / Docker pour produire un MP4 déterministe à partir d’un document HTML autonome.

## API

Toutes les routes `/api` exigent l’en-tête `x-f2k-render-key` correspondant à `F2K_RENDER_API_KEY`.

### Créer un job

`POST /api/video-jobs`

```json
{
  "html": "<!doctype html>...",
  "width": 1080,
  "height": 1920,
  "duration": 5,
  "fps": 30,
  "filename": "f2k-live-story.mp4"
}
```

Retour : HTTP 202 avec `jobId`, `status` et `progress`.

### Suivre un job

`GET /api/video-jobs/{jobId}`

### Télécharger

`GET /api/video-jobs/{jobId}/download`

Les fichiers sont supprimés après `F2K_RETENTION_MS` (24 heures par défaut).

## Limites du prototype

- Une file d’attente en mémoire et un seul worker.
- Cloud Run doit être limité à une instance pour conserver l’état des jobs.
- Les jobs sont perdus si l’instance redémarre. Une version de production utilisera Cloud Tasks/Firestore ou la file interne de l’entreprise.
- La clé de service ne doit jamais être placée dans le HTML public. Le studio devra appeler ce service via un backend authentifié ou Make.
- Le document HTML envoyé doit être autonome : images intégrées en data URLs et styles nécessaires inclus.
- Pour Cloud Run, suivre `DEPLOY_CLOUD_RUN.md` depuis la racine `f2k-studio`.

## Variables

- `F2K_RENDER_API_KEY` obligatoire.
- `F2K_ALLOWED_ORIGIN` facultatif.
- `F2K_RETENTION_MS` facultatif.
- `PORT` fourni par Cloud Run.
