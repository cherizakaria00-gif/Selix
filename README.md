# Selix

Application immobilière pour le Maroc : app mobile et serveur dans un seul dépôt.

| Dossier | Contenu | Lancer |
| --- | --- | --- |
| [`app/`](app/) | App mobile Expo (SDK 57) : matching par swipe, assistant IA, carte, alertes, espace admin | `cd app && npm install && npx expo start` |
| [`api/`](api/) | API PHP + MySQL : comptes, biens, photos, swipes, leads, chat Claude, notifications push | voir [`api/README.md`](api/README.md) |

L'app lit l'adresse de l'API dans `app/.env` (`EXPO_PUBLIC_SELIX_API_URL`).
L'API est déployée sur DigitalOcean App Platform (dossier source `api/`), qui redéploie à chaque push sur `main`.
