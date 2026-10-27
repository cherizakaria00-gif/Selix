# Selix

Application immobilière pour le Maroc : app mobile et serveur dans un seul dépôt.

| Dossier | Contenu | Lancer |
| --- | --- | --- |
| [`app/`](app/) | App mobile Expo (SDK 58) : matching par swipe, assistant IA, carte, alertes, espace admin | `cd app && npm install && npx expo start` |
| [`api/`](api/) | API PHP + MySQL : comptes, biens, photos, swipes, leads, chat Claude, notifications push | voir [`api/README.md`](api/README.md) |

L'app lit l'adresse de l'API dans `app/.env` (`EXPO_PUBLIC_SELIX_API_URL`).
L'API est déployée sur DigitalOcean App Platform (dossier source `api/`), qui redéploie à chaque push sur `main`.

## Rôles (app.selix.io)

Le site web (`app/`, version web) est l'espace du personnel ; l'app mobile est celle des clients.
Une seule adresse et une seule connexion : l'interface s'adapte au rôle.

| Rôle | Créé par | Voit et fait |
| --- | --- | --- |
| `admin` (super admin) | seed de l'API (`SEED_ADMIN_PASSWORD`) | tout : biens, validation des biens des promoteurs, leads et assignation, équipe |
| `commercial` | le super admin (onglet Équipe) | **ses leads assignés** : coordonnées du client, statut, note, appel, WhatsApp |
| `promoteur` | le super admin (onglet Équipe) | **ses biens** : ajout et modification, état de validation, statistiques (vus, likes, visites) sans données clients |
| `user` | s'inscrit dans l'app mobile | matching, assistant, alertes |

- Un bien déposé (ou modifié) par un promoteur est « en attente » : invisible des clients et sans notification push
  tant que le super admin ne l'a pas validé. Un simple changement de statut (disponible, réservé, vendu) reste publié.
- Un lead (like ou demande de visite d'un client) arrive « non assigné » ; le super admin l'assigne à un commercial.
- Le super admin peut désactiver un compte (déconnecté partout, ses leads retournent « à assigner ») et réinitialiser son mot de passe.
- Toutes ces règles sont appliquées par l'API (`api/index.php`) ; l'interface ne fait que les refléter.
- Schéma : la migration v2 ajoute `selix_users.disabled` et `selix_leads.assigned_to` au premier appel suivant le déploiement.
