<?php
/**
 * POST /chat — assistant Selix propulsé par Claude.
 *
 * Contrat (voir askRemote() dans app/src/services/ai.ts) :
 *   requête : { message, history: [{ role, text }], position? }
 *   réponse : { reply, propertyIds, category, conversationContext, profile? }
 *
 * Pour les recommandations, le serveur classe les biens selon le profil enregistré.
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
- Une hausse du budget doit venir spontanément du client. Ne déduis jamais un nouveau budget du prix d'une annonce. Les règles du mode profile_edit continuent de s'appliquer à toute modification du profil.
- S'il manque une information essentielle (location ou achat, ville, budget), pose UNE question à la fois. Cette règle ne s'applique pas avant l'affichage des biens en mode type_exploration.
- Le serveur a déjà extrait les critères et fixé leur destination. Utilise criteresActifs et profileChanges tels quels : ne réinterprète pas une recherche temporaire comme une modification du profil. Ne dis « enregistré dans votre profil » que si allowProfileUpdate=true. Les critères temporaires restent en dehors du profil, des recommandations personnalisées et des notifications.
- Le profil fourni est le profil unique du client : il réunit ses critères actuels, les préférences apprises par les swipes et l'affinement des échanges avec l'IA.
- Si <contexte> indique queryMode="type_exploration", cette règle est prioritaire : dès qu'il y a au moins un candidat, sélectionne et présente jusqu'à 3 candidats chargés par le serveur, même si la transaction, la ville ou le budget ne sont pas précisés. Ne dis pas qu'il n'y a aucun bien si <candidats> en contient. Après les avoir présentés, demande un critère à préciser (achat/location, ville ou budget). Ces biens correspondent au type et uniquement aux critères de la demande actuelle. Ne modifie pas le profil enregistré.
- En mode type_exploration, le serveur transmet toutes les annonces correspondantes de la base, pas uniquement les suggestions classées de l'application.
- Le profil n'est modifié que lorsque <contexte> indique queryMode="profile_edit" et allowProfileUpdate=true. En mode "chat", réponds normalement sans modifier le profil enregistré. Une réponse telle que « achat » à ta question sur les villas affine les villas temporaires, même si un ancien échange portait sur le profil. Ne demande pas de confirmer la destination des critères.
- questionField décrit la seule précision demandée à la fin de reply : transaction, cities, districts, types, budget, bedroomsMin, mustHave ou other. Utilise none si tu ne poses aucune question. Le serveur rattache cette question au mode courant pour interpréter la prochaine réponse.
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
function chat_candidates_for_search(array $user, array $profile, ?array $position, bool $nearMe, ?array $scoringProfile = null): array
{
    $types = $profile['types'] ?? [];
    $driver = db()->getAttribute(PDO::ATTR_DRIVER_NAME);
    $sql = 'SELECT data FROM selix_properties';
    $parameters = [];
    if ($types && in_array($driver, ['sqlite', 'mysql'], true)) {
        $expression = $driver === 'sqlite' ? "json_extract(data, '$.type')" : "JSON_UNQUOTE(JSON_EXTRACT(data, '$.type'))";
        $sql .= ' WHERE ' . $expression . ' IN (' . implode(',', array_fill(0, count($types), '?')) . ')';
        $parameters = $types;
    }
    $rows = q($sql . ' ORDER BY created_at DESC', $parameters)->fetchAll(PDO::FETCH_COLUMN);
    $disliked = $scoringProfile === null ? [] : array_flip(q(
        "SELECT property_id FROM selix_swipes WHERE user_id = ? AND action = 'dislike'", [$user['id']],
    )->fetchAll(PDO::FETCH_COLUMN));
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
        if (!is_array($property) || ($types && !in_array($property['type'] ?? null, $types, true))) continue;
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
            'score' => score_property($scoringProfile ?? $profile, $property) - (isset($disliked[$property['id'] ?? '']) ? 100 : 0),
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

    error_log('[Selix exploration filters] type=' . implode(',', $types) . ' role=' . (string) ($user['role'] ?? 'user')
        . ' nearMe=' . ($nearMe ? '1' : '0') . ' ' . (json_encode($filterCounts) ?: '{}'));

    usort($candidates, static fn(array $a, array $b): int => $b['score'] <=> $a['score']);
    return $candidates;
}

/** Classe le tour dans les trois catégories et extrait uniquement les critères du message actuel. */
function chat_classify_turn(Client $client, string $message, array $history, array $conversationContext): array
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
    $message = '<etat_conversation>' . json_encode($conversationContext, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)
        . "</etat_conversation>\n\nMessage actuel : " . $message;
    $lastRole = $messages ? $messages[count($messages) - 1]['role'] : null;
    if ($lastRole !== 'user') {
        $messages[] = ['role' => 'user', 'content' => $message];
    } else {
        $messages[count($messages) - 1]['content'] .= "\nMessage actuel : " . $message;
    }

    $schema = [
        'type' => 'object',
        'properties' => [
            'category' => ['type' => 'string', 'enum' => ['GENERAL_SEARCH', 'PROFILE_UPDATE', 'CONTINUATION']],
            'explicitProfileUpdate' => ['type' => 'boolean'],
            'criteria' => chat_criteria_schema(),
        ],
        'required' => ['category', 'explicitProfileUpdate', 'criteria'],
        'additionalProperties' => false,
    ];
    $instructions = <<<'TXT'
Tu classes le dernier message immobilier Selix avec l'état fourni par le serveur. Comprends français, anglais, espagnol, arabe et darija (y compris Arabizi).
GENERAL_SEARCH : nouvelle exploration du catalogue, nouveau type ou nouvelle recherche indépendante. Exemples : « et les villas ? », « w lvilat », « quels bureaux sont disponibles ? ». Les critères sont temporaires. Une simple précision de la recherche active n'est PAS une nouvelle recherche.
PROFILE_UPDATE : modification de préférences durables, lorsque le client est dans mode=profile_edit, ou qu'il demande EXPLICITEMENT de mémoriser/enregistrer/changer son profil. « Désormais je veux seulement acheter », « retiens que mon budget est... » sont explicites. Mentionner « achat », « mon budget est... » ou « je veux... » pendant une recherche temporaire ne constitue PAS une demande durable.
CONTINUATION : réponse à lastQuestion, précision/correction de la recherche active, demande sur un bien proposé ou conversation générale. La destination reste celle de lastQuestion.target, sinon du mode actif. « Achat » après une question achat/location concernant les villas est CONTINUATION, criteria.transaction=achat, explicitProfileUpdate=false. « Rabat », « avec piscine », « 6 millions » après une question correspondante suivent la même règle. Une phrase courte n'exige pas de confirmation.
En mode=profile_edit, les changements de critères complètent le profil, MAIS une nouvelle exploration explicite ouvre GENERAL_SEARCH. Si forceNextProfileEdit=true, le prochain message appartient au profil, même s'il nomme un nouveau type.
En cas d'ambiguïté entre profil durable et recherche temporaire, choisis CONTINUATION si une exploration est active, sinon GENERAL_SEARCH. Ne demande aucune confirmation de destination.
criteria ne contient QUE les champs explicitement exprimés, corrigés ou supprimés par le message actuel. N'y recopie jamais tous les critères de l'historique ni du profil. Les réponses elliptiques utilisent le champ de lastQuestion.field. Les valeurs de temporaryCriteria déjà acquises sont fusionnées par le serveur. Ne déduis jamais achat/location d'un montant. « 6 millions de dirhams »=6000000 MAD ; si l'unité dirhams/centimes est ambiguë, n'invente pas la conversion.
Valeurs canoniques : transaction=achat|location ; types=appartement|villa|studio|riad|bureau|terrain ; villes/quartiers avec l'orthographe du catalogue (Casablanca, Marrakech, Rabat, Maârif...). mustHave utilise piscine, jardin, parking, meublé, vue mer, terrasse, ascenseur, sécurité, climatisation, balcon. Supprimer un filtre numérique/transaction = null ; supprimer une liste = []. Les champs non mentionnés sont ABSENTS, pas vides ni null. Une négation doit être comprise, pas inversée : « pas besoin de piscine » retire cette exigence, « pas de piscine » n'impose pas piscine. nearMe est seulement true/false si demandé ou annulé explicitement.
explicitProfileUpdate est true uniquement si le dernier message demande explicitement une modification durable ; le mode profil seul ne le rend pas true. Pour les salutations et les questions sans critère, criteria={}.
mustHave ajoute les équipements exprimés aux exigences actives ; [] efface toutes ces exigences. Pour retirer seulement un équipement, utilise removeMustHave : « pas besoin de piscine » donne removeMustHave=["piscine"], sans supprimer les autres équipements.
TXT;
    $res = $client->beta->messages->create(
        model: CHAT_MODEL,
        maxTokens: 1200,
        system: $instructions,
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
    throw new HttpError(502, 'Classification de conversation invalide.');
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
            'questionField' => ['type' => 'string', 'enum' => ['none', 'transaction', 'cities', 'districts', 'types', 'budget', 'bedroomsMin', 'mustHave', 'other']],
        ],
        'required' => ['reply', 'replyLanguage', 'propertyIds', 'questionField'],
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
    $conversationContext = chat_load_context((string) $user['id']);
    try {
        $classification = chat_classify_turn(
            $client, $message, is_array($in['history'] ?? null) ? $in['history'] : [], $conversationContext,
        );
    } catch (APIException $e) {
        error_log('Selix intent classification: ' . $e->getMessage());
        throw new HttpError(502, 'Impossible de déterminer le type de demande.');
    }
    $turn = chat_resolve_turn($conversationContext, $classification);
    $conversationContext = $turn['context'];
    $typeExploration = $conversationContext['mode'] === 'general_search';
    $effectiveMode = $typeExploration ? 'type_exploration' : $conversationContext['mode'];
    $savedJson = q('SELECT data FROM selix_docs WHERE user_id = ? AND kind = ?', [$user['id'], 'profile'])->fetchColumn();
    $savedProfile = $savedJson ? json_decode((string) $savedJson, true) : [];
    if (!is_array($savedProfile)) $savedProfile = [];
    $queryProfile = $typeExploration ? $turn['criteria'] : $savedProfile;
    if ($turn['allowProfileUpdate']) $queryProfile = chat_merge_criteria($savedProfile, $turn['profilePatch']);
    $position = is_array($in['position'] ?? null) ? $in['position'] : null;
    if ($typeExploration) {
        $candidates = chat_candidates_for_search($user, $queryProfile, $position, !empty($queryProfile['nearMe']));
    } else {
        $candidates = array_slice(chat_candidates_for_search($user, [], $position, false, $queryProfile), 0, 15);
    }
    error_log('[Selix chat intent] user=' . (string) $user['id']
        . ' category=' . $turn['category']
        . ' mode=' . $effectiveMode
        . ' profileWrite=' . ($turn['allowProfileUpdate'] ? '1' : '0')
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
    $replyHistory = is_array($in['history'] ?? null) ? $in['history'] : [];
    foreach (array_slice($replyHistory, -10) as $m) {
        $role = ($m['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
        $text = mb_substr(trim((string) ($m['text'] ?? '')), 0, 2000);
        if ($text === '' || (!$messages && $role === 'assistant')) continue;
        $messages[] = ['role' => $role, 'content' => $text];
    }
    $context = json_encode([
        'criteresActifs' => $queryProfile,
        'profil' => $typeExploration ? null : $queryProfile,
        'conversationContext' => $conversationContext,
        'category' => $turn['category'],
        'allowProfileUpdate' => $turn['allowProfileUpdate'],
        'profileChanges' => $turn['allowProfileUpdate'] ? $turn['profilePatch'] : null,
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
    $questionField = (string) ($data['questionField'] ?? 'none');
    if ($typeExploration && $ids && empty($data['propertyIds'])) {
        // Le LLM a demandé une précision avant de choisir des IDs; affiche d'abord les biens trouvés.
        $questionField = empty($queryProfile['transaction']) ? 'transaction' : (empty($queryProfile['cities']) ? 'cities' : 'none');
        $explorationReplies = [
            'fr' => 'Voici quelques biens disponibles. Vous préférez acheter ou louer ?',
            'en' => 'Here are some available properties. Would you prefer to buy or rent?',
            'ar' => 'هذه بعض العقارات المتاحة. هل تفضل الشراء أم الكراء؟',
            'es' => 'Estos son algunos inmuebles disponibles. ¿Prefieres comprar o alquilar?',
        ];
        if ($questionField === 'cities') {
            $explorationReplies = [
                'fr' => 'Voici quelques biens disponibles. Dans quelle ville souhaitez-vous chercher ?',
                'en' => 'Here are some available properties. Which city would you like to search in?',
                'ar' => 'هذه بعض العقارات المتاحة. في أي مدينة تريد البحث؟',
                'es' => 'Estos son algunos inmuebles disponibles. ¿En qué ciudad quieres buscar?',
            ];
        } elseif ($questionField === 'none') {
            $explorationReplies = [
                'fr' => 'Voici quelques biens correspondant à cette recherche.',
                'en' => 'Here are some properties matching this search.',
                'ar' => 'هذه بعض العقارات المطابقة لهذا البحث.',
                'es' => 'Estos son algunos inmuebles que coinciden con esta búsqueda.',
            ];
        }
        $reply = $explorationReplies[$data['replyLanguage'] ?? 'fr'] ?? $explorationReplies['fr'];
    }
    if ($questionField === 'none' && preg_match('/[?؟]/u', $reply)) $questionField = 'other';
    $committed = chat_commit_turn((string) $user['id'], $turn, $reply, $questionField);
    $out = [
        'reply' => $reply,
        'propertyIds' => array_slice($ids, 0, 3),
        'intent' => $typeExploration ? 'exploration' : ($effectiveMode === 'profile_edit' ? 'profile_edit' : 'chat'),
        'category' => $turn['category'],
        'allowProfileUpdate' => $turn['allowProfileUpdate'],
        'conversationContext' => $committed['conversationContext'],
    ];
    if ($turn['allowProfileUpdate']) {
        $out['needs'] = $turn['profilePatch'];
        $out['profile'] = $committed['profile'];
    }
    return $out;
}
