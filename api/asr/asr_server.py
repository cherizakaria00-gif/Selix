import os
os.environ["TORCH_DEVICE_BACKEND_AUTOLOAD"] = "0"
import tempfile
from pathlib import Path
from time import perf_counter
import av
import ctranslate2
import librosa
import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from faster_whisper import WhisperModel
import numpy as np
app = FastAPI(title="ASR Whisper Server - Selix")

print("Chargement du modèle Silero VAD...")
vad_model, utils = torch.hub.load(
    repo_or_dir='snakers4/silero-vad', 
    model='silero_vad', 
    trust_repo=True
)
(get_speech_timestamps, _, _, _, _) = utils



# Chemin ancré sur ce fichier, indépendant du dossier du terminal.
MODEL_PATH = Path(__file__).resolve().parent / "models" / "morocco-darija-whisper-ct2"
for filename in ("model.bin", "config.json", "tokenizer.json", "preprocessor_config.json"):
    if not (MODEL_PATH / filename).is_file():
        raise RuntimeError(f"Fichier CT2 manquant : {MODEL_PATH / filename}. Voir asr/README.md.")

device = os.getenv("SELIX_ASR_DEVICE") or ("cuda" if ctranslate2.get_cuda_device_count() else "cpu")
compute_type = os.getenv("SELIX_ASR_COMPUTE_TYPE") or ("float16" if device == "cuda" else "int8")
print(f"Chargement faster-whisper : {MODEL_PATH} ({device}, {compute_type})...", flush=True)
model = WhisperModel(str(MODEL_PATH), device=device, compute_type=compute_type, local_files_only=True)

vocab_brut = (
    "كتب الكلام المسموع بالدارجة المغربية وبالحروف العربية. "
    "خلي الكلمات الفرنسية بالفرنسية وما تترجمهاش. كلمات العقار: "
    "دار، شقة، فيلا، ستوديو، رياض، بيت، غرفة، كراء، شراء، درهم، "
    "الثمن، الميزانية، مليون، درهم، سنتيم،étage،صالون، حمام، كراج، "
    "بوسكورة،المحمدية،القنيطرة، دار بوعزة، تمارة،سلا،مكناس،فاس،وجدة"
    "appartement, villa, studio, riad, chambre, location, achat, Casablanca, Marrakech, Rabat."
    "Bouskoura,Mohammedia,Kénitra,Dar Bouazza,Témara,Salé,Meknès,Fes,Oujda."
    "أنفا، المعاريف، غوتيه، سيل، بوركون، راسين، عين دياب، سيدي معروف، "
    "كاليفورنيا، الواحة، الحي المحمدي، سيدي البرنوصي، عين السبع، بوسكورة، "
    "دار بوعزة، درب السلطان، الحبوس، البالميي، لوازيس، "
    "Anfa, Maarif, Gauthier, CIL, Bourgogne, Racine, Ain Diab, "
    "Sidi Maarouf, Californie, Oasis, Bouskoura, Dar Bouazza, Habous"
)


# Liste noire des hallucinations YouTube fréquentes
HALLUCINATIONS_CONNUES = [
    "اشتركوا في القناة",
    "اشترك في القناة",
    "لا تنسوا الاشتراك",
    "شكرا على المشاهدة",
    "ترجمة نانسي قنقر"
]

def contient_voix_humaine(audio_array: np.ndarray, sampling_rate: int = 16000) -> bool:
    """Vérifie s'il y a au moins 0.4 seconde de vraie parole humaine."""
    try:
        audio_tensor = torch.tensor(audio_array, dtype=torch.float32)
        timestamps = get_speech_timestamps(
            audio_tensor, 
            vad_model, 
            sampling_rate=sampling_rate, 
            threshold=0.5
        )
        if not timestamps:
            return False
        duree_parole = sum((t['end'] - t['start']) for t in timestamps) / sampling_rate
        return duree_parole >= 0.4
    except Exception as e:
        print(f"Erreur VAD: {e}")
        return True

def nettoyer_hallucinations(texte: str) -> str:
    """Étape 3 : Nettoie le texte en interceptant la blacklist."""
    texte_propre = texte.strip()
    for phrase in HALLUCINATIONS_CONNUES:
        if phrase in texte_propre:
            return ""
    return texte_propre


def charger_audio_16khz(path: str) -> tuple[np.ndarray, int]:
    """Decode les formats mobiles (notamment M4A/AAC) et convertit en mono 16 kHz."""
    morceaux = []
    with av.open(path) as container:
        if not container.streams.audio:
            raise ValueError("Le fichier reçu ne contient pas de piste audio.")

        resampler = av.AudioResampler(format="fltp", layout="mono", rate=16000)
        for frame in container.decode(audio=0):
            for output in resampler.resample(frame):
                morceaux.append(output.to_ndarray().reshape(-1))

        # Vide les derniers échantillons conservés par le rééchantillonneur.
        for output in resampler.resample(None):
            morceaux.append(output.to_ndarray().reshape(-1))

    if not morceaux:
        raise ValueError("Aucun échantillon audio décodable dans le fichier reçu.")
    return np.concatenate(morceaux).astype(np.float32, copy=False), 16000


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    suffix = os.path.splitext(file.filename or "")[1] or ".ogg"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name

        # PyAV décode aussi le M4A/AAC produit par l'enregistreur Expo sur iOS.
        audio_array, sampling_rate = charger_audio_16khz(tmp_path)

        # --- BARRÈTTE 1 : Filtre Silero VAD (sur l'audio brut) ---
        has_voice = contient_voix_humaine(audio_array, sampling_rate)
        if not has_voice:
            print("Silero VAD : Aucun signal vocal pertinent détecté (bruit/silence).")
            return {"status": "success", "text": ""}
        
       # Coupe les silences inutiles (< 25 dB) après validation de la voix
        audio_array, _ = librosa.effects.trim(audio_array, top_db=25)
        if len(audio_array) == 0:
            return {"status": "success", "text": ""}
        
       # --- BARRÈTTE 2 : Inférence Whisper sécurisée + Prompt Immobilier ---
        started_at = perf_counter()
        segments, info = model.transcribe(
            audio_array,
            task="transcribe",
            language=None,
            initial_prompt=vocab_brut,
            temperature=0.0,
            no_speech_threshold=0.6,
            log_prob_threshold=-1.0,
            compression_ratio_threshold=2.4,
            no_repeat_ngram_size=3,
            repetition_penalty=1.0,
            beam_size=1,
            vad_filter=False,  # Silero a déjà vérifié la présence de parole ci-dessus.
        )
        # L'inférence est effectuée lors de l'itération sur les segments.
        texte_brut = " ".join(segment.text.strip() for segment in segments).strip()
        print(f"[Selix ASR] faster-whisper terminé en {perf_counter() - started_at:.1f}s ; langue={info.language}", flush=True)

        # --- BARRÈTTE 3 : Liste noire anti-hallucination ---
        texte_final = nettoyer_hallucinations(texte_brut)
        print("-------resultat de transcription :------- \n", texte_final)
        return {"status": "success", "text": texte_final}
    

    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    finally:
        await file.close()
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)

