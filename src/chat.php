<?php
/**
 * POST /chat — assistant Selix propulsé par Claude.
 *
 * Contrat (voir askRemote() dans selix/src/services/ai.ts) :
 *   requête : { message, history: [{ role, text }], profile, candidates: [{ id, score, title, ... }] }
 *   réponse : { reply, propertyIds, needs? }
 *
 * L'app pré-classe les biens avec son moteur local et n'envoie que les meilleurs
 * candidats : Claude choisit parmi eux, il n'invente jamais de bien.
 */

declare(strict_types=1);

use Anthropic\Client;
use Anthropic\Core\Exceptions\APIException;

const CHAT_MODEL = 'claude-opus-5-5';

const CHAT_SYSTEM = <<<'TXT'
Tu es l'assistant de Selix, agence immobilière au Maroc (location et achat : appartements, villas, studios, riads, bureaux, terrains).
Ton rôle : comprendre ce que cherche le client et lui proposer les biens qui lui correspondent.

Règles :
- Réponds dans la langue du client : français par défaut, darija marocaine (en lettres latines) s'il écrit en darija, anglais s'il écrit en anglais.
- Sois chaleureux, concret et bref : 2 à 4 phrases, sans liste à puces ni markdown. Les prix sont en MAD (DH).
- Ne propose QUE des biens présents dans <candidats>, par leur id, dans propertyIds (3 au maximum, les plus pertinents d'abord). Ne cite aucun bien qui n'y est pas et n'invente ni prix ni caractéristique.
- Si aucun candidat ne convient vraiment, dis-le honnêtement, laisse propertyIds vide et pose une question utile (budget, ville, type, nombre de chambres…).
- S'il manque une information essentielle (location ou achat, ville, budget), pose UNE question à la fois.
- needs : uniquement ce que le client vient d'exprimer ou de modifier dans son dernier message (laisse vide ce qu'il n'a pas dit). Villes et quartiers avec l'orthographe des données Selix (ex. Casablanca, Marrakech, Dar Bouazza, Maârif). Budget en MAD : loyer mensuel pour une location, prix total pour un achat (« 2 millions » = 2000000, « 15k » = 15000).
- Pour une visite, un appel ou une négociation, explique qu'un conseiller Selix le recontacte, ou qu'il peut demander une visite depuis la fiche du bien.
TXT;

function chat_schema(): array
{
    $strings = ['type' => 'array', 'items' => ['type' => 'string']];
    return [
        'type' => 'object',
        'properties' => [
            'reply' => ['type' => 'string'],
            'propertyIds' => $strings,
            'needs' => [
                'type' => 'object',
                'properties' => [
                    'transaction' => ['type' => 'string', 'enum' => ['location', 'achat']],
                    'cities' => $strings,
                    'districts' => $strings,
                    'types' => ['type' => 'array', 'items' => ['type' => 'string', 'enum' => ['appartement', 'villa', 'studio', 'riad', 'bureau', 'terrain']]],
                    'budgetMin' => ['type' => 'number'],
                    'budgetMax' => ['type' => 'number'],
                    'bedroomsMin' => ['type' => 'integer'],
                    'mustHave' => $strings,
                ],
                'additionalProperties' => false,
            ],
        ],
        'required' => ['reply', 'propertyIds', 'needs'],
        'additionalProperties' => false,
    ];
}

function handle_chat(array $user): array
{
    $key = config('anthropic_api_key');
    if (!$key) throw new HttpError(503, 'Assistant IA non configuré.');
    rate_limit('chat:' . $user['id'], 40, 3600);

    $in = body();
    $message = trim((string) ($in['message'] ?? ''));
    if ($message === '' || mb_strlen($message) > 2000) throw new HttpError(400, 'Message vide ou trop long.');
    $candidates = array_slice(is_array($in['candidates'] ?? null) ? $in['candidates'] : [], 0, 20);

    // Historique : alternance user/assistant commençant par user, 10 derniers messages.
    $messages = [];
    foreach (array_slice(is_array($in['history'] ?? null) ? $in['history'] : [], -10) as $m) {
        $role = ($m['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
        $text = mb_substr(trim((string) ($m['text'] ?? '')), 0, 2000);
        if ($text === '' || (!$messages && $role === 'assistant')) continue;
        $messages[] = ['role' => $role, 'content' => $text];
    }
    $context = json_encode(['profil' => $in['profile'] ?? null, 'candidats' => $candidates], JSON_UNESCAPED_UNICODE);
    $messages[] = ['role' => 'user', 'content' => "<contexte>\n$context\n</contexte>\n\n$message"];

    $client = new Client(apiKey: $key, baseUrl: config('anthropic_base_url') ?: 'https://api.anthropic.com');
    try {
        $res = $client->beta->messages->create(
            model: CHAT_MODEL,
            maxTokens: 4000,
            system: [['type' => 'text', 'text' => CHAT_SYSTEM, 'cacheControl' => ['type' => 'ephemeral']]],
            messages: $messages,
            outputConfig: ['effort' => 'low', 'format' => ['type' => 'json_schema', 'schema' => chat_schema()]],
            // Si les garde-fous du modèle déclinent, l'API relance la même requête sur un modèle de repli.
            fallbacks: 'default',
            betas: ['server-side-fallback-2026-07-01'],
        );
    } catch (APIException $e) {
        error_log('Selix chat: ' . $e->getMessage());
        throw new HttpError(502, 'Assistant IA indisponible.');
    }

    if ($res->stopReason === 'refusal') {
        return ['reply' => "Je ne peux pas vous aider sur ce point. Parlons de votre projet immobilier : vous cherchez à louer ou à acheter ?", 'propertyIds' => []];
    }
    $data = null;
    foreach ($res->content as $block) {
        if ($block->type === 'text') {
            $data = json_decode($block->text, true);
            break;
        }
    }
    if (!is_array($data) || !is_string($data['reply'] ?? null)) throw new HttpError(502, 'Réponse IA invalide.');

    $allowed = array_flip(array_map(fn($c) => (string) ($c['id'] ?? ''), $candidates));
    $ids = array_values(array_filter($data['propertyIds'] ?? [], fn($id) => is_string($id) && isset($allowed[$id])));
    $out = ['reply' => $data['reply'], 'propertyIds' => array_slice($ids, 0, 3)];
    $needs = array_filter($data['needs'] ?? [], fn($v) => $v !== null && $v !== [] && $v !== '');
    if ($needs) $out['needs'] = $needs;
    return $out;
}
