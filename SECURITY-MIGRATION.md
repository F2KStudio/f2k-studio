# Migration coordonnée des deux studios

État : code à tester sur des révisions Cloud Run sans trafic. Ne pas fusionner puis publier directement sur GitHub Pages : les nouvelles interfaces nécessitent un serveur sur la même origine.

## Architecture et prérequis

- Déployer séparément F2K Studio et Magic Studio, chacun avec son interface et ses API sur la même origine HTTPS. Les cookies ne circulent pas entre les deux sites.
- Définir `STUDIO_ORIGIN` (origine HTTPS exacte, sans slash), `STUDIO_SESSION_SECRET` (64 caractères aléatoires minimum) et `STUDIO_ACCOUNTS_JSON` dans Secret Manager. Pas dans Git, les paramètres de build ou les fichiers publics.
- `STUDIO_ACCOUNTS_JSON` est un tableau de comptes : `[{"id":"client-a","passwordHash":"…"}]`. Utiliser un compte distinct par client et par application. L'identifiant ne change pas une fois des données enregistrées.
- Créer les empreintes avec `npm run hash-password` en transmettant le mot de passe sur l'entrée standard. Utiliser un mot de passe inédit de 12 caractères minimum. Scrypt utilise N=2^17, r=8, p=1 et un sel aléatoire de 16 octets. Aucun hash ou mot de passe réel dans le dépôt.
- Les sessions sont conservées en mémoire : elles sont révoquées au redémarrage. Rester à une instance, comme les files de rendu actuelles. Une session peut durer 12 heures ou 30 jours mais ne survit pas au redémarrage. Avant de monter en charge : stocker sessions, jobs et quotas dans un stockage partagé et persistant.
- Les limites en mémoire ne sont pas un plafond de facturation : conserver les budgets/quotas des fournisseurs et utiliser une protection réseau persistante avant une ouverture large.

## Configuration F2K

- `CUTOUT_WEBHOOK_URL` : webhook Make de détourage, conservé seulement sur le serveur.
- `CHAT_SARAH_WEBHOOK_URL` : webhook de messages existant, conservé seulement sur le serveur.
- Conserver `F2K_STORAGE_BUCKET` ou `F2K_STORAGE_DIR`, ainsi que les options de rendu/retention.
- Les anciens `F2K_ACCESS_CODE_HASH`, `F2K_SESSION_SECRET` et `F2K_RENDER_API_KEY` ne donnent plus accès. Mettre à jour les éventuels scripts externes utilisant l'ancienne clé avant de les basculer.
- Les projets et images sont stockés dans `workspace/v1/accounts/<identifiant>/…` (ou `accounts/<identifiant>` en local). L'ancien espace partagé est conservé sans attribution automatique : sauvegarder et affecter explicitement ses données aux bons clients avant la bascule.
- Les jobs vidéo appartiennent au compte qui les crée. Un autre compte ne peut ni les lire, ni les supprimer, ni les télécharger.
- Le rendu HTML n'a accès qu'au fichier HTML de rendu et à une liste de domaines publics d'images/polices. Vérifier tous les assets en préproduction ; ajouter un domaine seulement après examen. Les WebSockets sont bloqués.

## Configuration Magic Studio

- Définir `MAKE_GOODS_URL`, `MAKE_GOODS_STATUS_URL`, `MAKE_TCG_URL`, `MAKE_TCG_STATUS_URL` (si disponible), `MAKE_BACKGROUND_URL` dans Secret Manager.
- Définir `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` et `CLOUDINARY_API_SECRET` seulement sur le serveur. Les imports utilisent des signatures serveur, sans preset non signé dans la page.
- Les gabarits de rendu Goods et TCG conservent leur URL publique GitHub Pages pour les iframes, Make/Doppio et la vidéo. Aucun webhook/secret ne doit figurer dans ces gabarits.
- Le conteneur sert seulement les deux interfaces, le script de connexion, les gabarits explicitement autorisés et les API. Les aperçus modifiables utilisent les gabarits sur la même origine ; les liens exportés conservent leurs URL publiques. Il ne publie ni code serveur ni fichier d'environnement.
- Les anciennes interfaces expérimentales et la page de test webhook sont retirées ; conserver les gabarits de rendu tant que leurs URL sont utilisées.
- Les images Cloudinary signées à l'import restent des images de livraison publiques : ne pas y placer de documents confidentiels. Pour des assets confidentiels, prévoir une livraison authentifiée et revoir les liens publics de rendu.

## Ordre de bascule et rotation

1. Sauvegarder les données et garder un inventaire des URL/gabarits utilisés. Exporter les projets stockés dans le navigateur : un changement d'origine ne les transfère pas. Les nouvelles sauvegardes locales et le cache IndexedDB F2K sont préfixés par compte. Les anciennes sauvegardes ne sont pas réattribuées automatiquement : les exporter avant migration. Le navigateur reste un stockage local, accessible au titulaire du profil.
2. Identifier dans Make les scénarios de détourage, génération et suivi des DEUX studios, ainsi que toutes les connexions fournisseurs partagées. Les URL Make trouvées dans leurs HTML sont différentes ; cela ne dit pas si les clés fournisseurs sont partagées.
3. Dupliquer les scénarios pour les essais, sans couper les anciens. Créer les nouveaux accès en conservant temporairement ceux de production. Une clé fournisseur jamais exposée et correctement conservée dans Make ne nécessite pas automatiquement une rotation.
4. Configurer les nouveaux secrets côté serveur. Déployer deux révisions sans trafic avec une origine propre à chaque URL de test. Vérifier connexion, imports, détourage, génération PNG/fonds, suivi, vidéo, ZIP, sauvegarde et isolation entre deux comptes. Tester les sorties JSON et image réelles de Make.
5. Organiser la création et la remise des nouveaux identifiants aux clients par un canal privé. L'ancien code public est compromis et ne doit pas être réutilisé.
6. Basculer les deux outils et communiquer leurs liens. Les anciennes pages GitHub doivent mener vers les nouvelles interfaces ; conserver uniquement les gabarits de rendu nécessaires. Garder un retour arrière sur les révisions applicatives, sans réactiver de secrets compromis.
7. Après validation des deux outils, révoquer les anciens webhooks/identifiants réellement exposés, désactiver les anciens presets Cloudinary non signés et vérifier que les anciens accès sont refusés. Si une clé fournisseur partagée est compromise, la remplacer dans TOUS ses scénarios avant révocation.
8. Rendre les dépôts privés seulement après vérification de la continuité d'hébergement. Sur GitHub Free cela coupe Pages, donc il faut d'abord migrer aussi les gabarits Magic utilisés par Make/Doppio et mettre à jour leurs URL/allowlists. Ne pas modifier la visibilité maintenant.
9. Nettoyer l'historique Git séparément après sauvegarde et coordination des clones. Le nettoyage de la version courante ne retire pas les secrets de l'historique, des clones ou des caches.

## Validation et limites de cette livraison

Les tests locaux couvrent le hachage avec sels différents, la connexion, les cookies, les sessions falsifiées/révoquées, le refus des origines tierces, les routes non authentifiées et l'absence de configuration. Aucun appel de test n'est envoyé aux webhooks de production.

L'accès Google Cloud a été bloqué par la demande MFA du compte lors de la préparation. Aucun déploiement, remplacement de clé fournisseur, changement de webhook ou de visibilité GitHub n'est confirmé par cette livraison de code. Les parcours Make réels restent à valider en préproduction avant fusion/bascule.
