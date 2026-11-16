# Contexte de construction : api/asr (Source Directory dans App Platform).
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TORCH_DEVICE_BACKEND_AUTOLOAD=0 \
    TORCH_HOME=/home/asr/.cache/torch \
    NUMBA_CACHE_DIR=/home/asr/.cache/numba \
    SELIX_ASR_DEVICE=cpu \
    SELIX_ASR_COMPUTE_TYPE=int8 \
    PORT=8080

# libgomp : OpenMP pour CTranslate2/PyTorch ; libstdc++ : bibliothèques C++.
# libsndfile : SoundFile/librosa ; certificats : téléchargements HTTPS.
# PyAV fournit ses bibliothèques FFmpeg avec ses wheels : aucun binaire ffmpeg requis.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        libgomp1 \
        libsndfile1 \
        libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./requirements.txt

# Installer d'abord la version CPU de PyTorch pour éviter les dépendances CUDA.
RUN python -m pip install --upgrade pip \
    && python -m pip install 'torch>=2.5,<3' --index-url https://download.pytorch.org/whl/cpu \
    && python -m pip install -r requirements.txt


# Create non-root user and writable directories
RUN useradd --create-home --uid 10001 asr \
    && mkdir -p \
        /home/asr/.cache/torch \
        /home/asr/.cache/numba \
        /app/models/morocco-darija-whisper-ct2 \
    && chown -R asr:asr /home/asr/.cache /app/models

USER asr

# Preload Silero VAD during Docker build
RUN python -c "import torch; torch.hub.load(repo_or_dir='snakers4/silero-vad', model='silero_vad', trust_repo=True)"

# Copy FastAPI server
COPY --chown=asr:asr asr_server.py ./asr_server.py

# Download the public model from Hugging Face
ARG HF_MODEL_REPO=kawtarBld/Morocco-Darija-STT-large-ct2

RUN python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='${HF_MODEL_REPO}', local_dir='/app/models/morocco-darija-whisper-ct2')"

# Verify downloaded model files
RUN python -c "import json; from pathlib import Path; p=Path('/app/models/morocco-darija-whisper-ct2'); assert (p/'model.bin').is_file() and (p/'model.bin').stat().st_size > 100000000, 'Model weights missing'; [json.loads((p/f).read_text()) for f in ('config.json', 'tokenizer.json', 'preprocessor_config.json', 'vocabulary.json')]"

EXPOSE 8080

# Start FastAPI with one worker
CMD ["sh", "-c", "exec python -m uvicorn asr_server:app --host 0.0.0.0 --port \"${PORT:-8080}\" --workers 1"]
