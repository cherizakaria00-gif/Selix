# Selix — application mobile (iOS & Android)

Application immobilière intelligente pour le Maroc : matching par swipe, assistant IA,
alertes quand un bien qui vous correspond est à proximité, et espace admin.

Expo SDK 58 · Expo Router · TypeScript.

## Lancer l'application

```bash
npm install
npx expo start
```

Scannez le QR code avec **Expo Go** (iOS / Android). Les comptes de démonstration sont créés
sur le serveur à partir de `selix-api/config.php`.

## Fonctionnalités

| Côté client | Côté admin |
| --- | --- |
| Inscription guidée qui collecte les besoins (location/achat, ville, type, budget, chambres, équipements) | Tableau de bord : biens actifs, clients, leads, taux de like, biens les plus aimés |
| **Matching** : swipe gauche (non), droite (j'aime), haut (coup de cœur) | **Biens** : ajout / modification / suppression, photos, statut (disponible, réservé, vendu) |
| **Assistant IA** : chat en français (et quelques mots de darija) qui comprend les besoins et propose des biens | **Position GPS du bien** : toucher la carte ou « Ma position » sur place |
| **Carte** : biens compatibles, rayon d'alerte autour de vous, itinéraire | **Leads** : chaque like / demande de visite, appel ou WhatsApp en un geste, suivi du statut |
| **Alertes de proximité** : notification « ce bien est à 700 m de vous » (rayon réglable 500 m → 10 km) | |
| Notification quand un nouveau bien correspond à vos critères | |
| Fiche bien : galerie, score de compatibilité et ses raisons, itinéraire, WhatsApp, demande de visite | |

## Comment fonctionne l'IA (`src/services/ai.ts`)

- **Apprentissage** : chaque swipe ajuste des poids (ville, quartier, type, équipements, gamme de prix).
- **Score 0–100 %** : besoins exprimés + préférences apprises. Au-delà de 65 %, le bien est
  « fait pour vous » : il déclenche les alertes de proximité et les notifications de nouveaux biens.
- **Assistant** : moteur local qui comprend « appartement 2 chambres à louer à Casa, max 15 000 DH ».
  Quand l'API est configurée, le serveur répond avec Claude (`selix-api/src/chat.php`) en
  choisissant parmi les biens pré-classés par l'app ; la clé reste côté serveur.

## Localisation en arrière-plan

| | App ouverte | App fermée |
| --- | --- | --- |
| Expo Go | ✅ alertes de proximité | ❌ (limite d'Expo Go) |
| Build installé (EAS) | ✅ | ✅ géofencing natif (`src/services/proximity.ts`) |

Pour un build installable : `npx eas-cli@latest build --profile development --platform all`.

## Backend

Les biens, comptes, swipes, leads, profils IA et conversations sont stockés sur le serveur
Selix (dossier `../selix-api/`, PHP + MySQL sur l'hébergement Hostinger) : un bien publié par
l'admin apparaît chez tous les clients. Copiez `.env.example` en `.env` et indiquez l'URL de
l'API (`EXPO_PUBLIC_SELIX_API_URL`). Le déploiement est décrit dans `selix-api/README.md`.

- Authentification par jeton (trousseau de l'appareil via `expo-secure-store`) ; les mots de
  passe sont hachés côté serveur.
- Photos des biens envoyées sur le serveur à l'enregistrement.
- Assistant : le serveur interroge Claude ; sans réseau, le moteur local répond.
- Notifications « nouveau bien pour vous » envoyées par le serveur (build EAS nécessaire).
- Hors connexion, l'app affiche les dernières données reçues.
