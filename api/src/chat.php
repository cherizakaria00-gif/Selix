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

const CHAT_SYSTEM = <<<'TXT'
Tu es l'assistant de Selix, agence immobilière au Maroc (location et achat : appartements, villas, studios, riads, bureaux, terrains).
Ton rôle : comprendre ce que cherche le client et lui proposer les biens qui lui correspondent.

Règles :
- Les seules langues autorisées pour reply sont le français (fr), l'anglais (en), l'arabe (ar) et l'espagnol (es). Réponds dans la langue du dernier message du client : français en français, anglais en anglais, arabe en arabe et espagnol en espagnol. Même si le client te demande une autre langue, ne réponds jamais dans une langue extérieure à ces quatre choix.
- La darija marocaine, écrite en caractères arabes ou en Arabizi (par exemple « bghit », « chno kayn », « wach »), appartient ici au choix ar : réponds en arabe avec l'alphabet arabe ; tu peux employer la darija si le message est en darija. Les mots français isolés comme « budget », « appartement » ou « studio » ne changent pas la langue dominante du message.
- Si le message mélange plusieurs langues, utilise sa langue dominante parmi les quatre choix. Pour une réponse très courte, un montant seul ou une langue non prise en charge, reprends la dernière langue prise en charge employée par le client dans l'historique ; à défaut, utilise le français. Le français des consignes, des champs de contexte, des annonces et des réponses précédentes de l'assistant ne doit pas imposer la langue de reply.
- Renseigne replyLanguage avec fr, en, ar ou es selon cette décision ; le texte reply doit respecter ce choix. Les noms propres, titres officiels des annonces et clés techniques du JSON peuvent conserver leur forme d'origine.
- Sois chaleureux, concret et bref : 2 à 4 phrases, sans liste à puces ni markdown. Les prix sont en MAD (DH).
- Ne propose QUE des biens présents dans <candidats>, par leur id, dans propertyIds (3 au maximum, les plus pertinents d'abord). Ne cite aucun bien qui n'y est pas et n'invente ni prix ni caractéristique.
- Si aucun candidat ne convient vraiment, dis-le honnêtement, laisse propertyIds vide et pose une question utile (budget, ville, type, nombre de chambres…).
- Respecte le budget annoncé par le client. Ne lui demande jamais de l'augmenter, de le dépasser ou de faire un effort financier, même pour inclure un bien précis. N'emploie pas de formulations comme « pouvez-vous augmenter votre budget ? » ou « wach ntl3o lmizania l 7.2 milion bach tdkhel Villa Souissi ? ».
- Si les biens disponibles dépassent son budget, indique simplement qu'aucun bien ne correspond dans cette limite. Propose, sans insistance, d'explorer une autre ville, un autre quartier, une surface, un type ou des équipements différents en conservant le même budget. Tu peux demander le budget s'il n'a pas encore été précisé ; s'il est déjà connu, ne le redemande pas dans le but de le revoir à la hausse.
- Une hausse du budget doit venir spontanément du client. Ne déduis jamais un nouveau budget du prix d'une annonce et ne renseigne jamais un budget supérieur dans needs sans demande explicite du client. Les règles du mode profile_edit continuent de s'appliquer à toute modification du profil.
- S'il manque une information essentielle (location ou achat, ville, budget), pose UNE question à la fois. Cette règle ne s'applique pas avant l'affichage des biens en mode type_exploration.
- needs : uniquement ce que le client vient d'exprimer ou de modifier dans son dernier message (laisse vide ce qu'il n'a pas dit). Villes et quartiers avec l'orthographe des données Selix (ex. Casablanca, Marrakech, Dar Bouazza, Maârif). Budget en MAD : loyer mensuel pour une location, prix total pour un achat (« 2 millions » = 2000000, « 15k » = 15000).
- Le profil fourni est le profil unique du client : il réunit ses critères actuels, les préférences apprises par les swipes et l'affinement des échanges avec l'IA.
- Si <contexte> indique queryMode="type_exploration", cette règle est prioritaire : dès qu'il y a au moins un candidat, sélectionne et présente jusqu'à 3 candidats chargés par le serveur, même si la transaction, la ville ou le budget ne sont pas précisés. Ne dis pas qu'il n'y a aucun bien si <candidats> en contient. Après les avoir présentés, demande un critère à préciser (achat/location, ville ou budget). Ces biens correspondent au type et uniquement aux critères de la demande actuelle. Ne modifie pas le profil enregistré.
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

/** Ne garde que les critères explicitement transmis pour la requête courante, jamais le profil sauvegardé. */
function chat_explicit_query_criteria(mixed $input, string $message = ''): array
{
    if (!is_array($input)) $input = [];
    $criteria = [];
    if (in_array($input['transaction'] ?? null, ['location', 'achat'], true)) {
        $criteria['transaction'] = $input['transaction'];
    } elseif (preg_match('/الكراء|كراء|نكري/u', $message)) {
        $criteria['transaction'] = 'location';
    } elseif (preg_match('/الشراء|شراء|للبيع|نشري/u', $message)) {
        $criteria['transaction'] = 'achat';
    }
    foreach (['cities', 'districts', 'mustHave'] as $field) {
        $values = $input[$field] ?? [];
        if (is_array($values)) {
            $criteria[$field] = array_values(array_filter($values, 'is_string'));
        }
    }
    foreach (['budgetMin', 'budgetMax', 'bedroomsMin'] as $field) {
        if (isset($input[$field]) && is_numeric($input[$field])) {
            $criteria[$field] = $field === 'bedroomsMin' ? (int) $input[$field] : (float) $input[$field];
        }
    }
    return $criteria;
}

/** Détection de secours pour les formulations darija sans ambiguïté, après la classification LLM. */
function chat_explicit_exploration_type(string $message): ?string
{
    $text = mb_strtolower($message);
    $types = [
        'appartement' => '/\b(?:l?appart(?:ement)?s?|appartements?|ch9a|ch9at)\b|شقق|شقة|بارطما/u',
        'villa' => '/\b(?:l?vilat|l?villat|l?villas?|villas?)\b|الفيلات|فيلات|فيلا|فلل/u',
        'studio' => '/\b(?:l?studios?|l?studyo)\b|استوديو|ستوديو/u',
        'riad' => '/\b(?:l?riads?|l?ryad)\b|الرياض|رياض/u',
        'bureau' => '/\b(?:l?bureaux?|l?buro(?:uat)?|bureaux?)\b|المكاتب|مكاتب|مكتب/u',
        'terrain' => '/\b(?:l?terrains?|l?ard|l?aradi)\b|الأراضي|اراضي|أرض|ارض/u',
    ];
    $type = null;
    foreach ($types as $candidate => $pattern) {
        if (preg_match($pattern, $text)) {
            $type = $candidate;
            break;
        }
    }
    if ($type === null) return null;

    $asksToSeeListings = preg_match('/\b(?:nchouf|nchof|nchoof|chouf|chof|voir|montre|montrez|affiche|show|disponible|existent|kayn|kaynin)\b|شنو\s+كاين|وريني|بغيت\s+نشوف/u', $text)
        || preg_match('/\b(?:w|ou|et)\s+l?(?:vilat|villas?|buro(?:uat)?|bureaux?|studios?|riads?|terrains?|appart(?:ement)?s?)\b/u', $text);
    return $asksToSeeListings ? $type : null;
}

/** Continues a type exploration when the user answers the assistant's request for search criteria. */
function chat_exploration_followup_type(array $history, array $currentCriteria): ?string
{
    $hasCriteria = !empty($currentCriteria['transaction'])
        || !empty($currentCriteria['cities']) || !empty($currentCriteria['districts'])
        || !empty($currentCriteria['mustHave']) || isset($currentCriteria['budgetMin'])
        || isset($currentCriteria['budgetMax']) || isset($currentCriteria['bedroomsMin']);
    if (!$hasCriteria) return null;

    $recent = array_slice($history, -8);
    for ($i = count($recent) - 1; $i >= 0; $i--) {
        if (($recent[$i]['role'] ?? '') !== 'assistant') continue;
        $assistantText = (string) ($recent[$i]['text'] ?? '');
        $askedToRefine = preg_match('/[?؟]|location|achat|acheter|louer|ville|budget|crit[eè]re|الكراء|الشراء|مدينة|الثمن|الميزانية/iu', $assistantText);
        if (!$askedToRefine) return null;
        for ($j = $i - 1; $j >= 0; $j--) {
            if (($recent[$j]['role'] ?? '') !== 'user') continue;
            $previousType = chat_explicit_exploration_type((string) ($recent[$j]['text'] ?? ''));
            if ($previousType !== null) return $previousType;
        }
        return null;
    }
    return null;
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
    // Diagnostic ajouté : le compteur final seul ne disait pas si les annonces
    // manquaient dans la base ou étaient écartées par un filtre de visibilité/recherche.
    $filterCounts = [
        'dbRows' => count($rows), 'typeMatched' => 0, 'available' => 0,
        'visible' => 0, 'transactionFiltered' => 0, 'cityFiltered' => 0,
        'districtFiltered' => 0, 'budgetFiltered' => 0, 'bedroomsFiltered' => 0,
        'featuresFiltered' => 0, 'nearMeFiltered' => 0, 'included' => 0,
    ];

    foreach ($rows as $json) {
        $property = json_decode((string) $json, true);
        if (!is_array($property) || ($property['type'] ?? null) !== $type) continue;
        $filterCounts['typeMatched']++;
        if (($property['status'] ?? null) !== 'disponible') continue;
        $filterCounts['available']++;
        $owner = ($property['ownerId'] ?? null) === ($user['id'] ?? null);
        if (!$admin && !$owner && approval_of($property) !== 'validé') continue;
        $filterCounts['visible']++;

        if (!empty($profile['transaction']) && ($property['transaction'] ?? null) !== $profile['transaction']) {
            $filterCounts['transactionFiltered']++;
            continue;
        }
        if ($cities && !in_array($property['city'] ?? '', $cities, true)) {
            $filterCounts['cityFiltered']++;
            continue;
        }
        if ($districts && !in_array($property['district'] ?? '', $districts, true)) {
            $filterCounts['districtFiltered']++;
            continue;
        }
        if (isset($profile['budgetMin']) && (float) ($property['price'] ?? 0) < (float) $profile['budgetMin']) {
            $filterCounts['budgetFiltered']++;
            continue;
        }
        if (isset($profile['budgetMax']) && (float) ($property['price'] ?? 0) > (float) $profile['budgetMax']) {
            $filterCounts['budgetFiltered']++;
            continue;
        }
        if (isset($profile['bedroomsMin']) && (int) ($property['bedrooms'] ?? 0) < (int) $profile['bedroomsMin']) {
            $filterCounts['bedroomsFiltered']++;
            continue;
        }
        if (array_diff($features, is_array($property['features'] ?? null) ? $property['features'] : [])) {
            $filterCounts['featuresFiltered']++;
            continue;
        }
        if ($nearMe) {
            if (!$position || !isset($property['latitude'], $property['longitude'])) {
                $filterCounts['nearMeFiltered']++;
                continue;
            }
            if (chat_distance_km($position[0], $position[1], (float) $property['latitude'], (float) $property['longitude']) > 15) {
                $filterCounts['nearMeFiltered']++;
                continue;
            }
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
        $filterCounts['included']++;
    }

    error_log('[Selix exploration filters] type=' . $type . ' role=' . (string) ($user['role'] ?? 'user')
        . ' nearMe=' . ($nearMe ? '1' : '0') . ' ' . (json_encode($filterCounts) ?: '{}'));

    usort($candidates, static fn(array $a, array $b): int => $b['score'] <=> $a['score']);
    return $candidates;
}

/** Le modèle décide si le message demande une exploration du catalogue et identifie son type. */
function chat_classify_intent(Client $client, string $message, array $history, bool $profileEditRequested): array
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
            'intent' => ['type' => 'string', 'enum' => ['exploration', 'chat', 'profile_edit']],
            'propertyType' => ['type' => 'string', 'enum' => ['appartement', 'villa', 'studio', 'riad', 'bureau', 'terrain', 'none']],
        ],
        'required' => ['intent', 'propertyType'],
        'additionalProperties' => false,
    ];
    $modeInstruction = $profileEditRequested
        ? 'Le client vient de cliquer sur « Modifier avec l’assistant ». Dans ce parcours, choisis profile_edit par défaut lorsqu’il exprime ou modifie ce qu’il veut rechercher, y compris « je veux chercher des appartements et des studios », « je cherche une villa » ou « bghit n9elleb 3la appartement ». Le simple fait de nommer un type de bien ou d’employer « chercher » ne signifie jamais exploration. Choisis exploration uniquement si le dernier message demande clairement à voir les annonces du catalogue ou ce qui existe/disponible, par exemple « quelles villas sont disponibles ? », « montre-moi les appartements », « w lvilat ». Dans ce cas, n’applique pas les critères du profil. Sinon, garde profile_edit.'
        : 'Classe exploration si le dernier message demande clairement à voir les annonces disponibles ou ce qui existe dans le catalogue; sinon classe chat.';
    $res = $client->beta->messages->create(
        model: CHAT_MODEL,
        maxTokens: 300,
        system: 'Classifie le dernier message d’un client immobilier Selix. ' . $modeInstruction . ' Utilise le contexte récent pour comprendre les messages elliptiques, mais donne priorité à l’intention explicite du dernier message et aux règles du parcours en cours. Une demande d’exploration porte sur les annonces disponibles dans le catalogue; une intention de chercher ou de définir ses critères dans le parcours de modification est profile_edit. propertyType doit être le type demandé explicitement ou compris dans le contexte; sinon none. En dehors du parcours de modification, réponds chat pour les salutations, questions générales et demandes de visite. Les exemples ne sont pas exhaustifs.',
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
            'replyLanguage' => ['type' => 'string', 'enum' => ['fr', 'en', 'ar', 'es']],
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
        'required' => ['reply', 'replyLanguage', 'propertyIds', 'needs'],
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
    $profileEditRequested = ($in['conversationMode'] ?? '') === 'profile_edit';
    $forceProfileEdit = $profileEditRequested && !empty($in['forceProfileEdit']);
    try {
        $intent = $forceProfileEdit
            ? ['intent' => 'profile_edit', 'propertyType' => 'none']
            : chat_classify_intent(
                $client,
                $message,
                is_array($in['history'] ?? null) ? $in['history'] : [],
                $profileEditRequested,
            );
    } catch (APIException $e) {
        error_log('Selix intent classification: ' . $e->getMessage());
        throw new HttpError(502, 'Impossible de déterminer le type de demande.');
    }
    $queryProfile = chat_explicit_query_criteria($in['queryCriteria'] ?? null, $message);
    $type = (string) ($intent['propertyType'] ?? 'none');
    // Si le classifieur manque une demande darija explicite, son intention reste corrigée par ce signal sûr.
    $explicitExplorationType = chat_explicit_exploration_type($message);
    if (!$forceProfileEdit && $explicitExplorationType !== null) {
        $intent['intent'] = 'exploration';
        $intent['propertyType'] = $explicitExplorationType;
        $type = $explicitExplorationType;
    } elseif (!$forceProfileEdit) {
        $followupType = chat_exploration_followup_type(
            is_array($in['history'] ?? null) ? $in['history'] : [],
            $queryProfile,
        );
        if ($followupType !== null) {
            $intent['intent'] = 'exploration';
            $intent['propertyType'] = $followupType;
            $type = $followupType;
        }
    }
    $typeExploration = ($intent['intent'] ?? '') === 'exploration'
        && in_array($type, PROPERTY_TYPES, true);
    $effectiveMode = $typeExploration
        ? 'type_exploration'
        : (($intent['intent'] ?? '') === 'profile_edit' ? 'profile_edit' : 'chat');
    // queryProfile ne contient que des critères explicitement déclarés pour le tour actuel.
    if ($typeExploration) {
        // Le type vient du classifieur IA; les autres critères sont ceux exprimés dans le message courant.
        $queryProfile['types'] = [$type];
        $position = is_array($in['position'] ?? null) ? $in['position'] : null;
        $candidates = chat_candidates_by_type($type, $user, $queryProfile, $position, !empty($in['nearMe']));
    } else {
        $candidates = array_slice(is_array($in['candidates'] ?? null) ? $in['candidates'] : [], 0, 20);
    }
    error_log('[Selix chat intent] user=' . (string) $user['id']
        . ' intent=' . (string) ($intent['intent'] ?? 'chat')
        . ' type=' . $type
        . ' mode=' . $effectiveMode
        . ' candidates=' . count($candidates));

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
    $context = json_encode([
        'profil' => $typeExploration ? $queryProfile : ($in['profile'] ?? null),
        'candidats' => $candidates,
        'queryMode' => $effectiveMode,
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
    // En exploration, afficher d'abord jusqu'à trois annonces trouvées, même si le modèle pose une question de précision.
    if ($typeExploration && $candidates) {
        $ids = array_slice(array_values(array_filter(
            array_map(static fn(array $candidate): string => (string) ($candidate['id'] ?? ''), $candidates),
            static fn(string $id): bool => $id !== '',
        )), 0, 3);
    }
    $reply = $data['reply'];
    if ($typeExploration && $ids && empty($data['propertyIds'])) {
        // Le LLM a demandé une précision avant de choisir des IDs; affiche d'abord les biens trouvés.
        $explorationReplies = [
            'fr' => 'Voici quelques biens disponibles. Vous préférez acheter ou louer ?',
            'en' => 'Here are some available properties. Would you prefer to buy or rent?',
            'ar' => 'هذه بعض العقارات المتاحة. هل تفضل الشراء أم الكراء؟',
            'es' => 'Estos son algunos inmuebles disponibles. ¿Prefieres comprar o alquilar?',
        ];
        $reply = $explorationReplies[$data['replyLanguage'] ?? 'fr'] ?? $explorationReplies['fr'];
    }
    $out = [
        'reply' => $reply,
        'propertyIds' => array_slice($ids, 0, 3),
        'intent' => $typeExploration ? 'exploration' : (($intent['intent'] ?? '') === 'profile_edit' ? 'profile_edit' : 'chat'),
    ];
    $needs = array_filter($data['needs'] ?? [], fn($v) => $v !== null && $v !== [] && $v !== '');
    if ($needs) $out['needs'] = $needs;
    return $out;
}
