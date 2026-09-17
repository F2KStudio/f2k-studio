# F2K Visual Studio — dossier complet de passation

Dernière mise à jour : 27 août 2026  
Statut : pilote livré au client pour un mois de test.

> Document destiné à Sarah et à l’équipe ou l’IA qui doit reprendre, intégrer ou recréer l’outil. Il répertorie les accès connus, mais aucune clé API secrète en clair. Les secrets restent dans Make, Google Secret Manager ou les variables Cloud Run.

## 1. Résumé

F2K Visual Studio est un éditeur de visuels pour les lives de cartes Pokémon. L’utilisateur choisit un atelier et un format, importe des produits/cartes, modifie textes, couleurs et fonds, déplace/redimensionne/retourne les éléments, puis exporte un ou plusieurs PNG ou MP4.

Il comprend : cinq ateliers, onze couples atelier/format, presets selon le nombre de produits, mini-éditeur graphique, animations, bibliothèques locales, détourage PhotoRoom facultatif, exports PNG/ZIP/vidéo, formulaire « Chat Sarah », accès par code et backend Node/Cloud Run.

**Aucun appel OpenAI n’est effectué en production.** L’outil a été développé avec Codex/ChatGPT, mais son utilisation ne consomme aucun token OpenAI.

## 2. Accès et URLs

### Code et application

| Élément | Accès |
|---|---|
| Dossier local | `/Users/sarah/Documents/Codex/2026-08-14/file-users-sarah-documents-codex-2026-2/outputs/f2k-studio` |
| Frontend | `index.html` |
| Backend | `render-service/server.js` |
| Dépôt GitHub | https://github.com/F2KStudio/f2k-studio |
| Branche | `main` |
| Git remote | `https://github.com/F2KStudio/f2k-studio.git` |
| GitHub Pages | https://f2kstudio.github.io/f2k-studio/ |
| Production Cloud Run | https://f2k-studio-ffvf5flxjq-ew.a.run.app/ |

### Google Cloud

| Élément | Valeur |
|---|---|
| Projet | `f2k-506604` |
| Service | `f2k-studio` |
| Région | `europe-west1` |
| Cloud Run | https://console.cloud.google.com/run/detail/europe-west1/f2k-studio/metrics?project=f2k-506604 |
| Logs | https://console.cloud.google.com/logs/query?project=f2k-506604 |
| Secrets | https://console.cloud.google.com/security/secret-manager?project=f2k-506604 |

### Make et PhotoRoom

| Élément | Accès |
|---|---|
| Organisation Make | `1837560` sur https://eu1.make.com/ |
| Scénario détourage | https://eu1.make.com/1837560/scenarios/7070601/edit |
| Nom | `F2K Studio — Détourage` |
| Webhook actuel | `https://hook.eu1.make.com/3di6141mw2fw7k9rjsiztizc5gdev9hx` |
| PhotoRoom | https://app.photoroom.com/ |

Le webhook PhotoRoom est encore visible dans le HTML. Il faut idéalement le remplacer par une route serveur protégée puis le renouveler. La clé PhotoRoom est dans Make, dans l’en-tête `x-api-key`, jamais dans Git.

### Accès à l’outil

- Code partagé : `F2K-STUDIO-26!`
- SHA-256 dans le code : `37f8ed32fec54c684bf2007c292b0b4a236478895ca639287e823b1c31a3ae4b`
- Session serveur normale : 12 h ; « mémoriser » : 30 jours.
- Cinq erreurs : blocage local 15 minutes.
- La porte est désactivée en `file:`, localhost et `127.0.0.1` pour le développement.

Pour une autre application, remplacer ce code partagé par ses comptes, son SSO et ses permissions.

### Secrets à récupérer, sans les copier dans le frontend

- `F2K_RENDER_API_KEY` — clé technique du moteur vidéo ;
- `F2K_SESSION_SECRET` — signature des cookies ;
- `CHAT_SARAH_WEBHOOK_URL` — webhook Make de l’assistance ;
- clé API PhotoRoom — enregistrée dans Make ;
- connexion Gmail utilisée dans Make.

Les deux premiers sont dans Google Secret Manager. Le webhook Chat Sarah est configuré comme variable Cloud Run et se retrouve aussi dans le scénario Make correspondant.

## 3. Lancement local

```bash
cd /Users/sarah/Documents/Codex/2026-08-14/file-users-sarah-documents-codex-2026-2/outputs/f2k-studio
python3 -m http.server 8765 --bind 127.0.0.1
```

Ouvrir http://127.0.0.1:8765/. Éviter `file://` : certaines APIs, requêtes, pipettes et persistances peuvent être limitées.

Backend complet :

```bash
cd render-service
npm install
F2K_RENDER_API_KEY='secret-local' \
F2K_ACCESS_CODE_HASH='37f8ed32fec54c684bf2007c292b0b4a236478895ca639287e823b1c31a3ae4b' \
F2K_SESSION_SECRET='autre-secret-local' \
npm start
```

## 4. Ateliers et formats

1. **Annonce du live** (`live`) : Story, Post, Miniature Voggt, Bannière Web, Bannière Mobile. De 1 à 5 produits, trois cartes, logo, prix, titre, série, lien Voggt et animations.
2. **Complète ta collection** (`collection`) : Story. De 1 à 6 produits, placements par quantité, bandeaux éditables, arrivée des textes, clignotement et lévitation réglable.
3. **L’arbre du live** (`tree`) : Story et Post. Arbre, trois cartes en perspective et balancement léger.
4. **Quelle carte va-t-on obtenir ?** (`duel`) : Story et Post. Toujours deux cartes, VS recoloré, glissements latéraux. « Votez en story » existe uniquement en Post et ses textes sont modifiables.
5. **Retour sur le live** (`recap`) : Story et Post. Produits et trois statistiques animées. Valeurs et libellés « Boosters ouverts », « Cartes sorties », « Spectateurs » sont modifiables. Aucun réglage de cartes ni vote.

## 5. Éditeur graphique

Chaque élément a un `data-uid` et des propriétés `x`, `y`, `s` (taille), `r` (rotation), `z` (calque).

Fonctions : glisser-déposer, poignées directes, valeurs exactes, jauges, `Maj + clic` pour sélection multiple, déplacement/rotation/taille groupés, `Ctrl/Cmd + Z`, suppression, double clic texte et dépôt de fichiers directement sur produits/cartes.

Les placements validés sont dans l’objet JavaScript `states`, avec clés :

```text
atelier::format
atelier::format::nombreDeProduits
```

Exemple : `live::thumb-voggt::5`. Les modifications utilisateur sont mémorisées dans `localStorage` sous `f2k-compositions-v1`.

## 6. Produits, cartes, fonds et couleurs

- Produits/cartes isolés par atelier pendant la session.
- Bibliothèque de produits consultable, enrichissable et nettoyable.
- Imports multiples placés gauche → droite.
- Deux cartes fixes mais remplaçables dans l’atelier Duel.
- Fonds : blanc à motif, bleu marine, dégradés 2/3 couleurs, prairie, couleur libre, image personnelle.
- Le fond blanc reste blanc ; seules les formes grises prennent légèrement la couleur secondaire.
- Fonds personnels enregistrés dans IndexedDB via « Mes fonds enregistrés ».
- Dix dernières couleurs libres mémorisées.
- La couleur secondaire pilote contours, VS, statistiques/pictos, décorations, sélections et bandeaux.

## 7. Stockage navigateur

### localStorage

- compositions/placements ;
- produits enregistrés en data URLs ;
- couleurs récentes ;
- état de la porte d’accès.

### IndexedDB

Base `f2k-studio-assets`, version 2 :

- store `backgrounds` : fonds personnels ;
- store `cutouts` : résultats PhotoRoom.

Le détourage est indexé par SHA-256 : réimporter exactement la même image dans le même navigateur réutilise le résultat sans nouvel appel PhotoRoom.

Limites : `localStorage` est petit, certaines URLs `blob:` ne survivent pas au rechargement et les données ne sont pas partagées entre appareils. Pour une vraie intégration, migrer projets/assets vers une base et un stockage objet serveur.

## 8. Détourage PhotoRoom

Flux actuel :

```text
Import → choix original/détourage → cache IndexedDB
→ webhook Make → POST https://sdk.photoroom.com/v1/segment
→ PNG transparent → cache local
```

Architecture recommandée ailleurs :

```text
frontend authentifié → backend → PhotoRoom
```

Le backend doit vérifier session/type/poids, masquer la clé, limiter le quota, journaliser et mettre en cache.

## 9. Chat Sarah

**Chat Sarah n’est pas un chatbot IA.** C’est un formulaire d’assistance avec dictée vocale. Il ne répond pas automatiquement et ne consomme aucun crédit OpenAI.

Fonctions : avatar, e-mail facultatif, message max. 3 000 caractères, dictée française via Web Speech API, contexte page/atelier/format/date, envoi par Make vers `messbah.sarah@gmail.com`.

```text
Navigateur POST /api/chat-sarah
→ cookie vérifié par Express/Cloud Run
→ CHAT_SARAH_WEBHOOK_URL
→ Make
→ Gmail
→ messbah.sarah@gmail.com
```

Payload :

```json
{
  "source": "Chat Sarah — F2K Studio",
  "email": "facultatif",
  "message": "texte",
  "page": "URL",
  "atelier": "live",
  "format": "story",
  "envoye_le": "date ISO"
}
```

Pour réutiliser : reprendre le composant, modifier `source`, garder une route backend same-origin et configurer le webhook côté serveur. Ajouter CAPTCHA/rate limiting si public.

## 10. Exports

Frontend : `html-to-image@1.11.13` et `JSZip@3.10.1` via jsDelivr.

| Format | Largeur cible |
|---|---:|
| Story | 1080 px (≈1920 haut) |
| Post | 1080 px (≈1350 haut) |
| Miniature | 1080 px |
| Bannière Web | 1890 px |
| Bannière Mobile | 1260 px |

Le modal permet formats multiples, PNG/vidéo, tout sélectionner et ZIP. L’export attend la fin des animations et masque poignées/sélections.

### Vidéo production

Le frontend génère un HTML autonome. Express crée un job. Playwright/Chromium capture les frames à temps contrôlé. FFmpeg encode un MP4 H.264. Le navigateur suit et télécharge le job.

Routes :

- `GET /api/health`
- `POST /api/session`
- `POST /api/chat-sarah`
- `POST /api/video-jobs`
- `GET /api/video-jobs/:id`
- `DELETE /api/video-jobs/:id`
- `GET /api/video-jobs/:id/download`

En local, repli par Canvas + MediaRecorder, moins fiable. Limites pilote : file/jobs en mémoire, une seule instance, perte au redémarrage, stockage éphémère, pas de quotas. Pour monter en charge : Cloud Tasks + Firestore/Redis + Cloud Storage (ou équivalents).

## 11. Stack utilisée

| Couche | Technologie |
|---|---|
| Interface | HTML5, CSS, JavaScript sans framework |
| Polices | Google Fonts (Archivo Black, Knewave, Montserrat, Road Rage) |
| Édition | Pointer Events, CSS transforms, datasets |
| Persistance | localStorage + IndexedDB |
| Dictée | Web Speech API |
| PNG/ZIP | html-to-image + JSZip |
| Vidéo locale | Canvas + MediaRecorder |
| Backend | Node.js ES modules + Express 4 |
| Rendu | Playwright 1.55 + Chromium + FFmpeg |
| Déploiement | Docker, Cloud Build, Artifact Registry, Cloud Run |
| Automatisation | Make |
| Détourage | PhotoRoom Remove Background API |
| Versioning | Git + GitHub |
| Développement assisté | Codex/ChatGPT |

## 12. Coûts estimés au 27 août 2026

Tarifs à revérifier avant budget :

| Service | Coût indicatif |
|---|---:|
| GitHub Pages public | 0 $ |
| Make Free | 0 $, 1 000 crédits/mois |
| Make payant | ≈9 $/mois pour 5 000 crédits |
| PhotoRoom Basic | 0,02 $/image, à partir de 20 $/mois pour 1 000 |
| PhotoRoom Plus | 0,10 $/image |
| Cloud Run | paiement à l’usage ; probablement 0 à quelques dollars pour ce pilote, à vérifier sur facture |
| Cloud Build/Artifact Registry | faible, selon déploiements/stockage |
| OpenAI en production | 0 $ : aucun appel |
| Codex/ChatGPT de développement | selon l’abonnement utilisé |

Sources officielles :

- https://www.make.com/en/pricing
- https://www.photoroom.com/api/pricing
- https://cloud.google.com/run/pricing
- https://docs.github.com/en/pages/getting-started-with-github-pages
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://openai.com/business/pricing/

Budget pilote réaliste :

```text
Make             ≈  9 $/mois
PhotoRoom        ≈ 20 $/mois
Cloud Run        ≈  0 à quelques dollars/mois
GitHub           ≈  0 $/mois
Total probable   ≈ 29 à 35 $/mois, hors développement
```

Le coût réel dépend des nouvelles images détourées, modules Make et temps vidéo. Le cache PhotoRoom réduit les appels répétés.

## 13. Déploiement Cloud Run

```bash
cd /Users/sarah/Documents/Codex/2026-08-14/file-users-sarah-documents-codex-2026-2/outputs/f2k-studio
IMAGE=europe-west1-docker.pkg.dev/f2k-506604/f2k-studio/video-renderer:latest

gcloud builds submit \
  --config render-service/cloudbuild.yaml \
  --substitutions _IMAGE=$IMAGE .

gcloud run deploy f2k-studio \
  --image $IMAGE --region europe-west1 --allow-unauthenticated \
  --cpu 2 --memory 4Gi --concurrency 10 \
  --min-instances 0 --max-instances 1 --timeout 3600 \
  --no-cpu-throttling \
  --set-env-vars F2K_ACCESS_CODE_HASH=37f8ed32fec54c684bf2007c292b0b4a236478895ca639287e823b1c31a3ae4b,F2K_RETENTION_MS=86400000 \
  --set-secrets F2K_RENDER_API_KEY=f2k-render-api-key:latest,F2K_SESSION_SECRET=f2k-session-secret:latest
```

Configurer séparément `CHAT_SARAH_WEBHOOK_URL`. Ne jamais le committer.

## 14. Recréer/intégrer un outil similaire

Architecture cible :

```text
Application principale / SSO
→ module Studio React/Vue/Web Component
→ API authentifiée
   ├─ projets et presets
   ├─ bibliothèque d’assets
   ├─ détourage et cache
   ├─ assistance
   └─ jobs d’export
→ worker Playwright + FFmpeg
→ stockage objet temporaire
```

Ordre conseillé :

1. Définir ateliers, formats, dimensions et zones sûres en JSON.
2. Modéliser chaque élément : type, source, X/Y, taille, rotation, calque, animation.
3. Construire canvas et panneau de propriétés.
4. Ajouter sélection, poignées, multi-sélection et undo/redo.
5. Ajouter bibliothèque persistante par utilisateur/équipe.
6. Importer les presets validés sans modifier leur rendu.
7. Ajouter fonds, couleurs et animations.
8. Ajouter PNG, puis détourage backend/cache, puis vidéo asynchrone.
9. Ajouter auth, quotas, rate limiting, logs, budget et tests visuels.

Améliorations recommandées : TypeScript, modules séparés, presets JSON versionnés, base/stockage serveur, aucun secret frontend, file vidéo persistante, monitoring, RGPD et vérification des droits Pokémon/Voggt/F2K.

## 15. Prompt prêt pour une autre IA

```text
Je veux intégrer dans mon application un studio de création de visuels inspiré de F2K Visual Studio.

Lis HANDOFF.md et audite le projet existant avant toute réécriture. Propose une migration progressive qui préserve exactement les placements validés.

Objectifs : éditeur multi-ateliers/formats, presets selon quantité, textes/couleurs/fonds/images/animations éditables, déplacement/taille/rotation/calque, sélection multiple, undo/redo, bibliothèques persistantes, détourage backend avec cache SHA-256, export PNG/ZIP/MP4, Chat Sarah via API authentifiée et intégration au système de comptes existant.

Contraintes : TypeScript, modules, presets JSON versionnés, stockage serveur par équipe, aucune clé/webhook frontend, quotas, rate limiting, logs, monitoring, tests visuels Chrome/Safari.

Commence par :
1. cartographier code et données ;
2. proposer schémas projets/presets/assets ;
3. définir endpoints et secrets ;
4. proposer étapes sans régression ;
5. chiffrer infrastructure et exploitation.
```

## 16. Checklist de reprise

- [ ] Cloner et lancer localhost.
- [ ] Vérifier droits GitHub et Google Cloud.
- [ ] Retrouver/configurer le scénario Make Chat Sarah.
- [ ] Tester l’arrivée à `messbah.sarah@gmail.com`.
- [ ] Vérifier Make PhotoRoom et crédits.
- [ ] Retirer/renouveler le webhook PhotoRoom exposé.
- [ ] Tester cinq ateliers et tous formats.
- [ ] Exporter chaque PNG, un ZIP et des MP4 Story/Post.
- [ ] Vérifier logs, facture et alertes.
- [ ] Sauvegarder les presets avant refactorisation.

## 17. Arborescence importante

```text
f2k-studio/
├── index.html                 # interface, styles, presets, logique
├── HANDOFF.md                 # ce document
├── assets/                    # backgrounds, brand, cards, decor, pokemon, products, ui
└── render-service/
    ├── server.js              # API, auth, chat, vidéo
    ├── package.json
    ├── Dockerfile
    ├── cloudbuild.yaml
    ├── .env.example
    ├── README.md
    └── DEPLOY_CLOUD_RUN.md
```

## 18. Sécurité

- Considérer le webhook PhotoRoom publié comme exposé : le renouveler et le proxifier.
- Ne jamais donner les valeurs Secret Manager à une IA publique ni les committer.
- Remplacer le code partagé avant usage multi-client.
- GitHub Pages est statique : aucun secret/backend/auth forte.
- Valider/limiter tous les imports côté serveur.
- Définir conservation et suppression des images/messages.
- Vérifier licences et droits de marque avant exploitation commerciale.

## 19. Reprise du 17 septembre 2026 — export multi-navigateurs

État sauvegardé avant interruption :

- Les dernières modifications d’interface sont dans `index.html` : `BOXBREAK`, sélection liée entre les vignettes et le visuel, banque de cartes, demande de détourage pour les cartes, deux couleurs distinctes pour le texte et le fond du rond `1€ PDD`, et séparation entre le sélecteur de couleurs et les cartes décoratives animées.
- Le correctif principal d’export PNG est prêt localement : la page utilise `POST /api/png` quand le backend Cloud Run est disponible, avec repli sur l’ancien export navigateur.
- `render-service/server.js` contient la route `/api/png` fondée sur Playwright.
- La syntaxe du script de `index.html` et celle de `render-service/server.js` ont été vérifiées.
- Projet Google Cloud : `f2k-506604`.
- Service Cloud Run existant : `f2k-studio`, région `europe-west1`.
- URL publique utilisée par le client : `https://f2k-studio-ffvf5flxjq-ew.a.run.app/`.
- Cloud Shell est connecté au bon projet. Aucune nouvelle révision n’a encore été déployée et la production n’a pas été modifiée.
- Une archive temporaire du dossier complet existe pour la session courante à `/private/tmp/f2k-render-service.zip` (environ 62 Mo), mais il vaut mieux la recréer si la machine/session a été redémarrée.

Prochaine étape : envoyer le code dans Cloud Shell, lancer le build décrit dans `render-service/DEPLOY_CLOUD_RUN.md`, déployer une nouvelle révision, vérifier `/api/health` puis tester un export PNG depuis Safari/Chrome. Ne basculer le trafic que lorsque la nouvelle révision est saine.
