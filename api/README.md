# Selix API — backend de l'app mobile

API REST en PHP 8.1+ / MySQL, pensée pour l'hébergement Hostinger du site Selix.
Elle partage biens, comptes, swipes et leads entre tous les téléphones, héberge les
photos, envoie les notifications push, transcrit l'audio via Gemini et fait répondre l'assistant via Claude.

| Route | Accès | Rôle |
| --- | --- | --- |
| `POST /auth/login`, `POST /auth/register`, `POST /auth/logout`, `GET /me` | public / connecté | Comptes (mots de passe hachés avec `password_hash`, jetons stockés hachés) |
| `GET /properties` | public | Biens publiés |
| `PUT /properties/{id}`, `DELETE /properties/{id}` | admin | Publier / modifier / supprimer ; un nouveau bien déclenche les push |
| `POST /photos` | admin | Photo (JPEG, PNG, WebP, HEIC ; 12 Mo max) → `{ url }` |
| `GET/POST/DELETE /swipes` | connecté | Swipes (un like crée un lead) |
| `GET/POST /leads`, `PATCH /leads/{id}` | connecté / admin | Leads |
| `GET/PUT /me/profile`, `/me/chat`, `/me/seen` | connecté | Profil IA, historique du chat, biens déjà vus |
| `POST /push-tokens`, `DELETE /push-tokens/{token}` | connecté | Token push Expo de l'appareil |
| `POST /chat` | connecté | Assistant Claude (`claude-opus-5-5`), 40 messages/heure par client |
| `POST /transcribe` | connecté | Transcription audio Gemini, 30 demandes/heure par client |

Les tables (préfixe `selix_`) sont créées au premier appel, avec les 12 biens de
démonstration et les deux comptes de `config.php`.

## Déployer sur un Droplet DigitalOcean

Base : MySQL managé DigitalOcean (TLS obligatoire). Serveur : Droplet Docker (Ubuntu), région fra1.

```bash
git clone git@github.com:cherizakaria00-gif/selix-api.git && cd selix-api
cp selix.env.example selix.env && chmod 600 selix.env   # remplir les secrets
# déposer ca-certificate.crt (DigitalOcean → base → Download CA certificate)
SITE_ADDRESS=api.selix.io docker compose up -d --build   # ou <ip>.sslip.io sans DNS
```

Mise à jour : `git pull && docker compose up -d --build`. Caddy obtient le certificat HTTPS
tout seul ; les photos sont dans le volume Docker `uploads`.

## Photos : Space DigitalOcean

Le disque des conteneurs App Platform est effacé à chaque déploiement : quand `SPACES_KEY`,
`SPACES_SECRET` et `SPACES_BUCKET` sont définies, `POST /photos` envoie la photo dans le Space
(`photos/…`, lecture publique) et renvoie son URL CDN. Sans elles, la photo va dans `uploads/`.

| Variable | Valeur |
| --- | --- |
| `SPACES_KEY` / `SPACES_SECRET` | Clé d'accès Spaces (API → Spaces Keys), à chiffrer (Encrypt) |
| `SPACES_BUCKET` | Nom du Space |
| `SPACES_REGION` | `fra1` (par défaut) |
| `SPACES_CDN_URL` | Facultatif : `https://<space>.fra1.cdn.digitaloceanspaces.com` par défaut, ou domaine CDN personnalisé |

## Déployer sur Hostinger

1. **Base MySQL** : hPanel → Bases de données → MySQL. Vérifiez le nom d'utilisateur de la base
   `u262891370_selixapp` (souvent identique au nom de la base) et reportez-le dans `config.php`.
2. **Configurer** `config.php` (déjà prérempli, jamais versionné) :
   - `public_url` : l'URL où sera le dossier, ex. `https://selix.ma/api` ;
   - `anthropic_api_key` : clé créée sur console.anthropic.com (reste sur le serveur) ;
   - `gemini_api_key` : clé Gemini pour la transcription audio, ou variable serveur `GEMINI_API_KEY` ;
   - le mot de passe admin initial y est généré aléatoirement : connectez-vous avec, puis
     retirez-le du fichier (il ne sert qu'à la création de la base).
3. **Envoyer** tout le dossier `selix-api/` (y compris `vendor/` et les `.htaccess`) dans
   `public_html/api/` via le Gestionnaire de fichiers ou FTP.
4. **PHP** : hPanel → Avancé → Configuration PHP → version 8.3 (extensions `pdo_mysql`, `curl`,
   `fileinfo` activées par défaut).
5. **Vérifier** : `https://votre-domaine/api/` doit répondre `{"name":"Selix API","ok":true}`,
   et `https://votre-domaine/api/config.php` doit être refusé (403).

## Brancher l'app

Dans `selix/.env` :

```
EXPO_PUBLIC_SELIX_API_URL=https://votre-domaine/api
```

## Notifications push (build EAS requis)

1. `npx eas-cli@latest init` dans `selix/` (ajoute `extra.eas.projectId` dans `app.json`).
2. `npx eas-cli@latest credentials` : clé APNs (iOS) et FCM v1 (Android) pour le service push d'Expo.
3. `npx eas-cli@latest build --profile development --platform all`.

À la connexion d'un client, l'app enregistre son token ; quand l'admin publie un bien
disponible, le serveur calcule le score de chaque client (`src/match.php`, copie du
`scoreProperty()` de l'app) et notifie ceux au-dessus de 65 %. Expo Go ne reçoit pas de
push distant sur Android : l'app y garde la notification locale à l'ouverture.

## Tester en local

```bash
cp config.example.php /tmp/selix-config.php   # mettre 'dsn' => 'sqlite:/tmp/selix.sqlite'
SELIX_CONFIG=/tmp/selix-config.php php -S 127.0.0.1:8787 index.php
```
