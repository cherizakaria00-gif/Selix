# Serveur de transcription Selix

Depuis le dossier `selix/Selix/api`, démarrer le service dans PowerShell :

```powershell
.\.venv-asr\Scripts\python.exe -m uvicorn asr_server:app --app-dir asr --host 127.0.0.1 --port 8790
```

Arrêter l'ancien processus Uvicorn avec `Ctrl+C` avant de relancer le service.
L'environnement `.venv-asr` reste dans `api`. La liste principale des dépendances
est `asr/requirements.txt` ; le fichier `api/requirements-asr.txt` la référence.

L'API PHP continue d'appeler `http://127.0.0.1:8790/transcribe`.
La variable `SELIX_ASR_URL` peut remplacer cette URL.

Le serveur utilise faster-whisper et charge les poids locaux dans
`asr/models/morocco-darija-whisper-ct2/`, avec `model.bin`, `config.json`,
`tokenizer.json` et `preprocessor_config.json`.

Installer les dépendances depuis `api` :

```powershell
.\.venv-asr\Scripts\python.exe -m pip install -r requirements-asr.txt
```

Le calcul utilise `int8` sur CPU et `float16` sur GPU NVIDIA détecté par CTranslate2.
Le choix peut être remplacé avant de lancer Uvicorn :

```powershell
$env:SELIX_ASR_DEVICE = "cpu"
$env:SELIX_ASR_COMPUTE_TYPE = "int8"
```

Le vocabulaire existant est passé via `initial_prompt`. Le décodage PyAV,
le contrôle de parole Silero et le filtre d'hallucinations sont conservés.
La route renvoie toujours `{"status":"success","text":"..."}`.

## Déploiement DigitalOcean App Platform (CPU)

Ajouter un composant de type service nommé `asr`, dans la même application que PHP.
Choisir une construction Dockerfile. Si le dépôt contient les dossiers `api` et `app` :

- Source Directory : `/api/asr` (contexte de construction).
- Dockerfile Path : `api/asr/Dockerfile` (chemin depuis la racine du dépôt).
- Port HTTP / interne : `8080`.
- Run Command : laisser vide pour utiliser le `CMD` du Dockerfile.
- Contrôle de santé : TCP, avec un délai initial adapté au chargement du modèle
  (par exemple 120 secondes au départ, à ajuster selon les logs).
- Communication avec PHP : utiliser le réseau privé et le port interne 8080 ;
  aucune route publique n'est nécessaire pour ASR.

Si le dépôt contient directement le contenu de `api`, utiliser `/asr` comme Source
Directory et `asr/Dockerfile` comme Dockerfile Path.

Dans les variables d'environnement du composant PHP, définir :

```text
SELIX_ASR_URL=http://asr:8080/transcribe
```

Le nom `asr` doit correspondre au nom du composant. App Platform prend en charge le
démarrage du conteneur ; `docker-compose.yml` n'est pas utilisé pour ce déploiement.

Le Dockerfile installe Python 3.12, PyTorch CPU, les dépendances Python et les
bibliothèques système `libgomp1`, `libstdc++6`, `libsndfile1` et `ca-certificates`.
PyAV embarque les bibliothèques FFmpeg de décodage. Silero est téléchargé pendant
la construction et son cache est conservé dans l'image sous l'utilisateur `asr`.

Les cinq fichiers CT2 doivent être présents dans le contexte avant la construction :
`model.bin`, `config.json`, `tokenizer.json`, `preprocessor_config.json`, `vocabulary.json`,
dans `models/morocco-darija-whisper-ct2/`. Le Dockerfile les copie sans les télécharger.
Les poids occupent environ 3 Go : un fichier local non poussé dans le dépôt ne sera
pas présent sur App Platform. Avec Git LFS, vérifier que la construction reçoit les
vrais poids et non leurs pointeurs. Une autre possibilité est de construire l'image
localement puis de la déployer depuis DigitalOcean Container Registry.

Pour construire l'image localement depuis `api` :

```bash
docker build --platform linux/amd64 -t selix-asr ./asr
```

Prévoir de la mémoire pour le modèle large et son calcul, au-delà de la seule taille
des poids. Le service utilise un worker pour éviter plusieurs copies du modèle.

## Alternative : installation directe sur Ubuntu / Debian (CPU)

Depuis le dossier `api`, avec Python 3.12 disponible :

```bash
sudo apt-get update
sudo apt-get install -y python3.12-venv libgomp1 libsndfile1 ca-certificates
python3.12 -m venv .venv-asr
.venv-asr/bin/python -m pip install --upgrade pip
# Installer PyTorch CPU avant le reste pour éviter de télécharger les bibliothèques CUDA.
.venv-asr/bin/python -m pip install 'torch>=2.5,<3' --index-url https://download.pytorch.org/whl/cpu
.venv-asr/bin/python -m pip install -r asr/requirements.txt
.venv-asr/bin/python -m pip check
.venv-asr/bin/python -m uvicorn asr_server:app --app-dir asr --host 127.0.0.1 --port 8790
```

Copier aussi les quatre fichiers du modèle CT2 dans `asr/models/morocco-darija-whisper-ct2/` :
`pip install` n'installe pas les poids. Le premier chargement Silero via `torch.hub`
nécessite l'accès à GitHub et un cache utilisateur inscriptible.

Le `Dockerfile` à la racine de l'API lance PHP ; `asr/Dockerfile` lance le service
Python. Depuis PHP, son `127.0.0.1` ne désigne pas le conteneur ASR : utiliser
`SELIX_ASR_URL` comme indiqué dans la section App Platform.

Cette liste exprime des plages de versions compatibles attendues. Elle ne remplace
pas une validation dans l'environnement Linux cible, ni les bibliothèques CUDA/cuDNN
nécessaires à un déploiement GPU.
