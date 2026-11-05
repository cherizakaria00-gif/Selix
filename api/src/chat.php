<?php
/**
 * POST /chat — assistant Selix propulsé par Claude.
 *
 * Contrat (voir askRemote() dans app/src/services/ai.ts) :
 *   requête : { message, history: [{ role, text }], profile, candidates: [{ id, score, title, ... }] }
 *   réponse : { reply, propertyIds, needs? }
 *
 * Pour les recommandations, l'app pré-classe les biens et envoie les meilleurs candidats.
 * Pour une exploration de type, le serveur charge les annonces correspondantes depuis la base.
 */

declare(strict_types=1);

use Anthropic\Client;
use Anthropic\Core\Exceptions\APIException;

const CHAT_MODEL = 'claude-opus-5-5';

/* Ancienne consigne conservée pour comparaison :
 * - Darija marocaine en lettres latines.
 * - Un changement de type repartait toujours de zéro sans sauvegarder les anciens critères.
 */
const CHAT_SYSTEM = <<<'TXT'
Tu es l'assistant de Selix, agence immobilière au Maroc (location et achat : appartements, villas, studios, riads, bureaux, terrains).
Ton rôle : comprendre ce que cherche le client et lui proposer les biens qui lui correspondent.

Règles :
- Réponds dans la langue du client : français par défaut ; arabe en caractères arabes s'il s'exprime en arabe ; anglais s'il s'exprime en anglais.
- Sois chaleureux, concret et bref : 2 à 4 phrases, sans liste à puces ni markdown. Les prix sont en MAD (DH).
- Ne propose QUE des biens présents dans <candidats>, par leur id, dans propertyIds (3 au maximum, les plus pertinents d'abord). Ne cite aucun bien qui n'y est pas et n'invente ni prix ni caractéristique.
- Si aucun candidat ne convient vraiment, dis-le honnêtement, laisse propertyIds vide et pose une question utile (budget, ville, type, nombre de chambres…).
- S'il manque une information essentielle (location ou achat, ville, budget), pose UNE question à la fois.
- needs : uniquement ce que le client vient d'exprimer ou de modifier dans son dernier message (laisse vide ce qu'il n'a pas dit). Villes et quartiers avec l'orthographe des données Selix (ex. Casablanca, Marrakech, Dar Bouazza, Maârif). Budget en MAD : loyer mensuel pour une location, prix total pour un achat (« 2 millions » = 2000000, « 15k » = 15000).
- Le profil fourni est le profil unique du client : il réunit ses critères actuels, les préférences apprises par les swipes et l'affinement des échanges avec l'IA.
- Si <contexte> indique queryMode="type_exploration", présente les candidats chargés par le serveur depuis la base. Ils correspondent au nouveau type et uniquement aux critères de la demande actuelle. Demande ensuite quels autres critères le client souhaite explorer. Ne modifie pas le profil enregistré.
- En mode type_exploration, le serveur transmet toutes les annonces correspondantes de la base, pas uniquement les suggestions classées de l'application.
- Le profil n'est modifié que lorsque <contexte> indique queryMode="profile_edit". En mode "chat", réponds normalement sans modifier le profil enregistré.
- Si les candidats ne correspondent pas, dis-le clairement et demande quel critère l'utilisateur souhaite préciser.
- Pour une visite, un appel ou une négociation, explique qu'un conseiller Selix le recontacte, ou qu'il peut demander une visite depuis la fiche du bien.
TXT;

/** Distance à vol d'oiseau entre deux positions GPS, en kilomètres. */
function chat_distance_km(float $lat1, float $lon1, float $lat2, float $lon2): float
{
    $rad = static fn(float $degrees): float => $degrees * M_PI / 180;
    $dLat = $rad($lat2 - $lat1);
    $dLon = $rad($lon2 - $lon1);
    $a = sin($dLat / 2) ** 2 + cos($rad($lat1)) * cos($rad($lat2)) * sin($dLon / 2) ** 2;
    return 6371 * 2 * asin(sqrt($a));
}

/** Charge toutes les annonces visibles qui correspondent au type et aux critères de cette requête. */
function chat_candidates_by_type(string $type, array $user, array $profile, ?array $position, bool $nearMe): array
{
    $driver = db()->getAttribute(PDO::ATTR_DRIVER_NAME);
    $sql = match ($driver) {
        'sqlite' => "SELECT data FROM selix_properties WHERE json_extract(data, '$.type') = ? ORDER BY created_at DESC",
        'mysql' => "SELECT data FROM selix_properties WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.type')) = ? ORDER BY created_at DESC",
        default => 'SELECT data FROM selix_properties ORDER BY created_at DESC',
    };

    $rows = q($sql, $driver === 'sqlite' || $driver === 'mysql' ? [$type] : [])->fetchAll(PDO::FETCH_COLUMN);
    $cities = is_array($profile['cities'] ?? null) ? $profile['cities'] : [];
    $districts = is_array($profile['districts'] ?? null) ? $profile['districts'] : [];
    $features = is_array($profile['mustHave'] ?? null) ? $profile['mustHave'] : [];
    $admin = ($user['role'] ?? '') === 'admin';
    $position = $position && isset($position['latitude'], $position['longitude'])
        ? [(float) $position['latitude'], (float) $position['longitude']]
        : null;
    if ($nearMe && !$position) return [];
    $candidates = [];

    foreach ($rows as $json) {
        $property = json_decode((string) $json, true);
        if (!is_array($property) || ($property['type'] ?? null) !== $type || ($property['status'] ?? null) !== 'disponible') continue;
        $owner = ($property['ownerId'] ?? null) === ($user['id'] ?? null);
        if (!$admin && !$owner && approval_of($property) !== 'validé') continue;

        if (!empty($profile['transaction']) && ($property['transaction'] ?? null) !== $profile['transaction']) continue;
        if ($cities && !in_array($property['city'] ?? '', $cities, true)) continue;
        if ($districts && !in_array($property['district'] ?? '', $districts, true)) continue;
        if (isset($profile['budgetMin']) && (float) ($property['price'] ?? 0) < (float) $profile['budgetMin']) continue;
        if (isset($profile['budgetMax']) && (float) ($property['price'] ?? 0) > (float) $profile['budgetMax']) continue;
        if (isset($profile['bedroomsMin']) && (int) ($property['bedrooms'] ?? 0) < (int) $profile['bedroomsMin']) continue;
        if (array_diff($features, is_array($property['features'] ?? null) ? $property['features'] : [])) continue;
        if ($nearMe) {
            if (!$position || !isset($property['latitude'], $property['longitude'])) continue;
            if (chat_distance_km($position[0], $position[1], (float) $property['latitude'], (float) $property['longitude']) > 15) continue;
        }

        if (!$admin && !$owner) unset($property['ownerId'], $property['approval'], $property['rejectionReason']);
        $candidates[] = [
            'id' => (string) ($property['id'] ?? ''),
            'title' => (string) ($property['title'] ?? ''),
            'score' => score_property($profile, $property),
            'transaction' => (string) ($property['transaction'] ?? ''),
            'type' => (string) ($property['type'] ?? ''),
            'city' => (string) ($property['city'] ?? ''),
            'district' => (string) ($property['district'] ?? ''),
            'price' => (float) ($property['price'] ?? 0),
            'bedrooms' => (int) ($property['bedrooms'] ?? 0),
            'surface' => (float) ($property['surface'] ?? 0),
            'features' => is_array($property['features'] ?? null) ? $property['features'] : [],
        ];
    }

    usort($candidates, static fn(array $a, array $b): int => $b['score'] <=> $a['score']);
    return $candidates;
}

/** Le modèle décide si le message demande une exploration du catalogue et identifie son type. */
function chat_classify_intent(Client $client, string $message, array $history): array
{
    $messages = [];
    foreach (array_slice($history, -6) as $item) {
        $role = ($item['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
        $text = mb_substr(trim((string) ($item['text'] ?? '')), 0, 1000);
        $lastRole = $messages ? $messages[count($messages) - 1]['role'] : null;
        if ($text !== '' && (!$messages || $role === 'user' || $lastRole !== 'assistant')) {
            $messages[] = ['role' => $role, 'content' => $text];
        }
    }
    $lastRole = $messages ? $messages[count($messages) - 1]['role'] : null;
    if ($lastRole !== 'user') {
        $messages[] = ['role' => 'user', 'content' => $message];
    } else {
        $messages[count($messages) - 1]['content'] .= "\nMessage actuel : " . $message;
    }

    $schema = [
        'type' => 'object',
        'properties' => [
            'intent' => ['type' => 'string', 'enum' => ['exploration', 'chat']],
            'propertyType' => ['type' => 'string', 'enum' => ['appartement', 'villa', 'studio', 'riad', 'bureau', 'terrain', 'none']],
        ],
        'required' => ['intent', 'propertyType'],
        'additionalProperties' => false,
    ];
    $res = $client->beta->messages->create(
        model: CHAT_MODEL,
        maxTokens: 300,
        system: 'Classifie le dernier message d’un client immobilier Selix. Réponds exploration si le client veut voir, connaître, chercher ou comparer les annonces disponibles d’un type de bien, même avec une formulation elliptique (« et les villas ? », « les bureaux ? ») ou en darija (« bghit n3rf chno kayn f lvilat »). Utilise aussi le contexte récent pour comprendre les messages elliptiques. propertyType doit être le type demandé explicitement ou compris dans le contexte; sinon none. Réponds chat pour les salutations, questions générales, demandes de visite ou échanges qui ne demandent pas les annonces du catalogue. Les exemples ne sont pas exhaustifs.',
        messages: $messages,
        outputConfig: ['effort' => 'low', 'format' => ['type' => 'json_schema', 'schema' => $schema]],
        fallbacks: 'default',
        betas: ['server-side-fallback-2026-07-01'],
    );
    foreach ($res->content as $block) {
        if ($block->type === 'text') {
            $data = json_decode($block->text, true);
            if (is_array($data)) return $data;
            break;
        }
    }
    return ['intent' => 'chat', 'propertyType' => 'none'];
}

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
    $client = new Client(apiKey: $key, baseUrl: config('anthropic_base_url') ?: 'https://api.anthropic.com');
    $requestedMode = ($in['conversationMode'] ?? '') === 'profile_edit' ? 'profile_edit' : 'chat';
    // Ancienne décision remplacée : l'application envoyait queryMode + explorationType après sa détection locale.
    // $typeExploration = ($in['queryMode'] ?? null) === 'type_exploration';
    // $type = (string) ($in['explorationType'] ?? '');
    try {
        $intent = $requestedMode === 'profile_edit'
            ? ['intent' => 'profile_edit', 'propertyType' => 'none']
            : chat_classify_intent($client, $message, is_array($in['history'] ?? null) ? $in['history'] : []);
    } catch (APIException $e) {
        error_log('Selix intent classification: ' . $e->getMessage());
        throw new HttpError(502, 'Impossible de déterminer le type de demande.');
    }
    $type = (string) ($intent['propertyType'] ?? 'none');
    $typeExploration = $requestedMode !== 'profile_edit'
        && ($intent['intent'] ?? '') === 'exploration'
        && in_array($type, PROPERTY_TYPES, true);
    $queryProfile = is_array($in['queryCriteria'] ?? null) ? $in['queryCriteria'] : [];
    if ($typeExploration) {
        // Le type vient du classifieur IA; les autres critères sont ceux exprimés dans le message courant.
        $queryProfile['types'] = [$type];
        $position = is_array($in['position'] ?? null) ? $in['position'] : null;
        $candidates = chat_candidates_by_type($type, $user, $queryProfile, $position, !empty($in['nearMe']));
    } else {
        $candidates = array_slice(is_array($in['candidates'] ?? null) ? $in['candidates'] : [], 0, 20);
    }

    // Trace terminal pour contrôler les biens effectivement transmis au modèle, sans journaliser le profil ni l'audio.
    $loggedCandidates = array_map(
        static fn(array $candidate): array => [
            'id' => (string) ($candidate['id'] ?? ''),
            'title' => (string) ($candidate['title'] ?? ''),
        ],
        array_values(array_filter($candidates, 'is_array')),
    );
    error_log('[Selix chat candidates] user=' . (string) $user['id']
        . ' count=' . count($loggedCandidates)
        . ' ' . (json_encode($loggedCandidates, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '[]'));

    // Historique : alternance user/assistant commençant par user, 10 derniers messages.
    $messages = [];
    $replyHistory = $typeExploration ? [] : (is_array($in['history'] ?? null) ? $in['history'] : []);
    foreach (array_slice($replyHistory, -10) as $m) {
        $role = ($m['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
        $text = mb_substr(trim((string) ($m['text'] ?? '')), 0, 2000);
        if ($text === '' || (!$messages && $role === 'assistant')) continue;
        $messages[] = ['role' => $role, 'content' => $text];
    }
    // Ancien contexte gardé en commentaire : profil + candidats seulement.
    // $context = json_encode(['profil' => $in['profile'] ?? null, 'candidats' => $candidates], JSON_UNESCAPED_UNICODE);
    $context = json_encode([
        'profil' => $typeExploration ? $queryProfile : ($in['profile'] ?? null),
        'candidats' => $candidates,
        'queryMode' => $typeExploration ? 'type_exploration' : $requestedMode,
        'nombreCandidats' => count($candidates),
    ], JSON_UNESCAPED_UNICODE);
    $messages[] = ['role' => 'user', 'content' => "<contexte>\n$context\n</contexte>\n\n$message"];

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
    $out = [
        'reply' => $data['reply'],
        'propertyIds' => array_slice($ids, 0, 3),
        'intent' => $typeExploration ? 'exploration' : $requestedMode,
    ];
    $needs = array_filter($data['needs'] ?? [], fn($v) => $v !== null && $v !== [] && $v !== '');
    if ($needs) $out['needs'] = $needs;
    return $out;
}
