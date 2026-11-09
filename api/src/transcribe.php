<?php
/** Nouvelle transcription sécurisée via Gemini. Le client envoie un fichier multipart à POST /transcribe. */

declare(strict_types=1);


const TRANSCRIPTION_VOCAB_PROMPT = <<<'TXT'
Transcris en darija marocaine, en alphabet arabe si l'audio est en darija, Garde les mots français tels qu’ils sont prononcés. Ne traduis pas et n’ajoute aucun mot.
Moroccan real-estate search vocabulary: دار، شقة، فيلا، ستوديو، رياض، appartement، villa، studio، riad، بيت، بيوت، غرفة، غرف، chambre، chambres، كراء، للبيع، للكراء، شراء، location، achat، à louer، à vendre، المدينة، الحي، الثمن، الميزانية، درهم، مليون، مفروشة، jardin، garage، terrasse، meublé، parking، derham، Selix، Casablanca، Marrakech، Rabat، loyer، dirhams، dar، chqa، karra, نكري, نشري,
بغيت، كنقلب على، خاصني، عافاك قلب ليا على،
ورّيني، عطيني، زيد ورّيني، شي عرض، هاد العرض، هاد الدار،
هاد الشقة، هاد الفيلا، عجبني، عجباتني، زوين، مناسبة ليا،
بغيتها، ناخدها، موافق، متافق، إييه، آه، واخا، صافي،
بغيت نزورها، نحدد موعد، عيطو ليا، تاصلوا بيا،
ما عجباتنيش، ما بغيتهاش، ما مناسبانيش، ماشي هادي،
لا، لا شكرا، ماشي دابا، قلب ليا على شي حاجة أخرى
Transcris uniquement les paroles audibles .Si l’audio est silencieux ou ne contient pas de parole, renvoie une chaîne vide. N’invente rien. 
Transcris fidèlement l’audio en darija marocaine. Si un mot semble mal reconnu ou n’a pas de sens dans le contexte, utilise le contexte pour trouver le mot probablement prononcé. Ne traduis pas et ne reformule pas.
TXT;

// Liste séparée utilisée pour repérer une sortie qui ne serait qu'un écho de vocabulaire.
const TRANSCRIPTION_VOCAB_TERMS = 'دار شقة فيلا ستوديو رياض appartement villa studio riad بيت بيوت غرفة غرف chambre chambres كراء للبيع للكراء شراء location achat ville quartier prix budget dirham dirhams مليون meublée jardin garage terrasse parking Casablanca Marrakech Rabat loyer dar chqa karra';

use GuzzleHttp\Client;
use GuzzleHttp\Exception\GuzzleException;

/** Convertit la section vocabulaire du prompt existant en contexte accepté par Gemini. */
function transcription_custom_vocabulary(): array
{
    $marker = 'Moroccan real-estate search vocabulary:';
    $start = strpos(TRANSCRIPTION_VOCAB_PROMPT, $marker);
    if ($start === false) return [];

    $context = substr(TRANSCRIPTION_VOCAB_PROMPT, $start + strlen($marker));
    $context = preg_split('/\bTranscris uniquement\b/u', $context, 2)[0] ?? $context;
    $terms = preg_split('/[,;\r\n]+/u', $context, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    $terms = array_map(static fn(string $term): string => trim($term), $terms);
    return array_values(array_unique(array_filter($terms, static fn(string $term): bool => $term !== '')));
}

function handle_transcription(array $user): array
{
    $key = (string) (getenv('GEMINI_API_KEY') ?: config('gemini_api_key'));
    if ($key === '') throw new HttpError(503, 'Gemini transcription is not configured. Set GEMINI_API_KEY on the server.');

    rate_limit('transcribe:' . $user['id'], 30, 3600);
    $file = $_FILES['audio'] ?? null;
    if (!is_array($file)) throw new HttpError(400, 'Audio file is missing.');
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        $error = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
        if (in_array($error, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
            throw new HttpError(413, 'Audio recording is too large.');
        }
        throw new HttpError(400, 'The audio file was not received correctly.');
    }

    $size = (int) ($file['size'] ?? 0);
    if ($size <= 0) throw new HttpError(400, 'The audio recording is empty.');
    if ($size > 25 * 1024 * 1024) throw new HttpError(413, 'Audio recording is too large (25 MB maximum).');

    $path = (string) ($file['tmp_name'] ?? '');
    if ($path === '' || !is_uploaded_file($path)) throw new HttpError(400, 'Invalid audio file.');
    $extension = strtolower(pathinfo((string) ($file['name'] ?? ''), PATHINFO_EXTENSION));
    $allowed = ['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'ogg', 'wav', 'webm'];
    if (!in_array($extension, $allowed, true)) throw new HttpError(415, 'Audio format is not supported.');

    $handle = fopen($path, 'rb');
    if ($handle === false) throw new HttpError(400, 'Could not read the audio recording.');

    $uploadedFileName = null;
    $client = null;
    try {
        $client = new Client(['connect_timeout' => 10, 'timeout' => 120]);
        $audioBytes = stream_get_contents($handle);
        if ($audioBytes === false || strlen($audioBytes) !== $size) {
            throw new HttpError(400, 'Could not read the audio recording.');
        }

        $mimeTypes = [
            'flac' => 'audio/flac', 'm4a' => 'audio/mp4', 'mp3' => 'audio/mp3',
            'mp4' => 'audio/mp4', 'mpeg' => 'audio/mpeg', 'mpga' => 'audio/mpeg',
            'ogg' => 'audio/ogg', 'wav' => 'audio/wav', 'webm' => 'audio/webm',
        ];
        $mimeType = $mimeTypes[$extension];

        // Gemini Files API: upload the recording, then reference its URI in the transcription request.
        $uploadStart = $client->post('https://generativelanguage.googleapis.com/upload/v1beta/files', [
            'headers' => [
                'x-goog-api-key' => $key,
                'X-Goog-Upload-Protocol' => 'resumable',
                'X-Goog-Upload-Command' => 'start',
                'X-Goog-Upload-Header-Content-Length' => (string) $size,
                'X-Goog-Upload-Header-Content-Type' => $mimeType,
                'Content-Type' => 'application/json',
            ],
            'json' => ['file' => ['display_name' => 'selix-recording-' . bin2hex(random_bytes(6))]],
        ]);
        $uploadUrl = $uploadStart->getHeaderLine('x-goog-upload-url');
        if ($uploadUrl === '') throw new HttpError(502, 'Gemini did not return an audio upload URL.');

        $uploadResponse = $client->post($uploadUrl, [
            'headers' => [
                'Content-Length' => (string) $size,
                'X-Goog-Upload-Offset' => '0',
                'X-Goog-Upload-Command' => 'upload, finalize',
            ],
            'body' => $audioBytes,
        ]);
        $uploaded = json_decode((string) $uploadResponse->getBody(), true);
        $fileUri = (string) ($uploaded['file']['uri'] ?? '');
        $uploadedFileName = (string) ($uploaded['file']['name'] ?? '');
        if ($fileUri === '' || $uploadedFileName === '') throw new HttpError(502, 'Gemini did not confirm the audio upload.');

        $response = $client->post('https://generativelanguage.googleapis.com/v1beta/interactions', [
            'headers' => ['x-goog-api-key' => $key, 'Accept' => 'application/json'],
            'json' => [
                'model' => 'gemini-3.5-transcribe',
                'input' => [['type' => 'audio', 'uri' => $fileUri, 'mime_type' => $mimeType]],
                'generation_config' => [
                    'transcription_config' => ['custom_vocabulary' => transcription_custom_vocabulary()],
                ],
            ],
        ]);
        $data = json_decode((string) $response->getBody(), true);
        $textParts = [];
        foreach (($data['steps'] ?? []) as $step) {
            if (($step['type'] ?? '') !== 'model_output') continue;
            foreach (($step['content'] ?? []) as $part) {
                if (($part['type'] ?? '') === 'text' && isset($part['text'])) $textParts[] = (string) $part['text'];
            }
        }
        $text = trim(implode("\n", $textParts));
        // Une réponse vide est normale quand l'enregistrement ne contient aucune parole.
        if ($text === '') return ['text' => ''];

        // Nouveau filtre : compare aussi les échos partiels et les listes isolées de mots-clés.
        $normalize = static fn(string $value): string => mb_strtolower(
            trim((string) preg_replace('/[^\p{L}\p{N}]+/u', ' ', $value)),
        );
        $normalizedText = $normalize($text);
        $normalizedPrompt = $normalize(TRANSCRIPTION_VOCAB_PROMPT);
        if ($normalizedText === $normalizedPrompt) {
            return ['text' => ''];
        }
        $textWords = preg_split('/\s+/u', $normalizedText, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $promptWords = preg_split('/\s+/u', $normalizedPrompt, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $promptWordSet = array_fill_keys($promptWords, true);
        $promptWordMatches = count(array_filter(
            $textWords,
            static fn(string $word): bool => isset($promptWordSet[$word]),
        ));
        if (count($textWords) >= 10 && $promptWordMatches / count($textWords) >= 0.9) {
            return ['text' => ''];
        }

        $vocabularyWords = preg_split('/\s+/u', $normalize(TRANSCRIPTION_VOCAB_TERMS), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $vocabularyWordSet = array_fill_keys($vocabularyWords, true);
        $vocabularyOnlyMatches = count(array_filter(
            $textWords,
            static fn(string $word): bool => isset($vocabularyWordSet[$word]),
        ));
        if (count($textWords) >= 5 && $vocabularyOnlyMatches === count($textWords)) {
            return ['text' => ''];
        }
        return ['text' => $text];
    } catch (GuzzleException $error) {
        error_log('Selix Gemini transcription: ' . $error->getMessage());
        throw new HttpError(502, 'Gemini could not transcribe this recording. Check GEMINI_API_KEY, model access, and available quota.');
    } finally {
        // Uploaded recordings are temporary; delete them after transcription.
        if ($client instanceof Client && is_string($uploadedFileName) && preg_match('#^files/[A-Za-z0-9_-]+$#', $uploadedFileName)) {
            try {
                $client->delete('https://generativelanguage.googleapis.com/v1beta/' . $uploadedFileName, [
                    'headers' => ['x-goog-api-key' => $key],
                ]);
            } catch (GuzzleException $cleanupError) {
                error_log('Selix Gemini temporary audio cleanup: ' . $cleanupError->getMessage());
            }
        }
        // Guzzle peut déjà avoir fermé le flux après l'envoi.
        if (is_resource($handle)) {
            fclose($handle);
        }
    }
}

