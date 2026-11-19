<?php
declare(strict_types=1);

function chat_empty_context(): array
{
    return ['version' => 1, 'mode' => 'chat', 'temporaryCriteria' => [], 'lastQuestion' => null, 'forceNextProfileEdit' => false];
}

function chat_criteria_schema(): array
{
    $strings = ['type' => 'array', 'items' => ['type' => 'string']];
    return [
        'type' => 'object',
        'properties' => [
            'transaction' => ['anyOf' => [
                ['type' => 'string', 'enum' => ['location', 'achat']],
                ['type' => 'null'],
            ]],
            'cities' => $strings, 'districts' => $strings, 'mustHave' => $strings, 'removeMustHave' => $strings,
            'types' => ['type' => 'array', 'items' => ['type' => 'string', 'enum' => PROPERTY_TYPES]],
            'budgetMin' => ['anyOf' => [['type' => 'number'], ['type' => 'null']]],
            'budgetMax' => ['anyOf' => [['type' => 'number'], ['type' => 'null']]],
            'bedroomsMin' => ['anyOf' => [['type' => 'integer'], ['type' => 'null']]],
            'nearMe' => ['type' => 'boolean'],
        ],
        'additionalProperties' => false,
    ];
}

function chat_normalize_criteria(mixed $input): array
{
    if (!is_array($input)) return [];
    $criteria = [];
    if (array_key_exists('transaction', $input) && in_array($input['transaction'], [null, 'achat', 'location'], true)) {
        $criteria['transaction'] = $input['transaction'];
    }
    foreach (['cities', 'districts', 'types', 'mustHave', 'removeMustHave'] as $field) {
        if (!isset($input[$field]) || !is_array($input[$field])) continue;
        $values = array_filter($input[$field], static fn($value): bool => is_string($value) && trim($value) !== '');
        $values = array_map(static fn(string $value): string => mb_substr(trim($value), 0, 120), $values);
        if ($field === 'types') $values = array_intersect($values, PROPERTY_TYPES);
        $criteria[$field] = array_slice(array_values(array_unique($values)), 0, 30);
    }
    foreach (['budgetMin', 'budgetMax', 'bedroomsMin'] as $field) {
        if (!array_key_exists($field, $input)) continue;
        if ($input[$field] === null) $criteria[$field] = null;
        elseif (is_numeric($input[$field]) && is_finite((float) $input[$field]) && (float) $input[$field] >= 0) {
            $criteria[$field] = $field === 'bedroomsMin' ? (int) $input[$field] : (float) $input[$field];
        }
    }
    if (isset($input['nearMe']) && is_bool($input['nearMe'])) $criteria['nearMe'] = $input['nearMe'];
    return $criteria;
}

/** Fusionne uniquement les champs exprimés ; aucune préférence enregistrée n'est ajoutée à une exploration. */
function chat_merge_criteria(array $base, array $patch): array
{
    if (array_key_exists('transaction', $patch) && ($base['transaction'] ?? null) !== $patch['transaction']) {
        unset($base['budgetMin'], $base['budgetMax']);
    }
    if (array_key_exists('cities', $patch) && !array_key_exists('districts', $patch)) unset($base['districts']);
    if (array_key_exists('budgetMax', $patch) && !array_key_exists('budgetMin', $patch)) unset($base['budgetMin']);
    foreach ($patch as $field => $value) {
        if ($field === 'removeMustHave') continue;
        if ($value === null) unset($base[$field]);
        elseif ($field === 'mustHave' && $value) $base[$field] = array_values(array_unique(array_merge($base[$field] ?? [], $value)));
        else $base[$field] = $value;
    }
    if (!empty($patch['removeMustHave'])) {
        $base['mustHave'] = array_values(array_diff($base['mustHave'] ?? [], $patch['removeMustHave']));
    }
    return $base;
}

function chat_load_context(string $userId): array
{
    $raw = q('SELECT data FROM selix_docs WHERE user_id = ? AND kind = ?', [$userId, 'chat_context'])->fetchColumn();
    $stored = $raw ? json_decode((string) $raw, true) : null;
    if (!is_array($stored)) return chat_empty_context();
    $context = array_replace(chat_empty_context(), $stored);
    if (!in_array($context['mode'], ['chat', 'general_search', 'profile_edit'], true)) return chat_empty_context();
    $context['temporaryCriteria'] = chat_normalize_criteria($context['temporaryCriteria']);
    return $context;
}

function chat_save_context(string $userId, array $context): void
{
    q('REPLACE INTO selix_docs (user_id, kind, data) VALUES (?, ?, ?)', [
        $userId, 'chat_context', json_encode($context, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
    ]);
}

function chat_context_response(array $context): array
{
    $context['temporaryCriteria'] = (object) $context['temporaryCriteria'];
    return $context;
}

/** Le bouton existant change immédiatement la destination, même avant le prochain message. */
function chat_begin_profile_edit(string $userId): array
{
    $context = chat_empty_context();
    $context['mode'] = 'profile_edit';
    $context['forceNextProfileEdit'] = true;
    chat_save_context($userId, $context);
    return chat_context_response($context);
}

/** Séparation effective : la destination d'une réponse courte appartient à la question précédente. */
function chat_resolve_turn(array $context, array $classification): array
{
    $category = $classification['category'] ?? 'CONTINUATION';
    if (!in_array($category, ['GENERAL_SEARCH', 'PROFILE_UPDATE', 'CONTINUATION'], true)) $category = 'CONTINUATION';
    $patch = chat_normalize_criteria($classification['criteria'] ?? []);
    $explicitProfileUpdate = ($classification['explicitProfileUpdate'] ?? false) === true;

    if (!empty($context['forceNextProfileEdit'])) {
        $category = 'PROFILE_UPDATE';
    } elseif ($explicitProfileUpdate) {
        $category = 'PROFILE_UPDATE';
    } elseif ($category === 'PROFILE_UPDATE' && $context['mode'] !== 'profile_edit') {
        // Une préférence simplement mentionnée dans une exploration n'est jamais permanente.
        $category = $context['mode'] === 'general_search' ? 'CONTINUATION' : 'GENERAL_SEARCH';
    }

    if ($category === 'GENERAL_SEARCH') {
        $context['mode'] = 'general_search';
        $context['temporaryCriteria'] = chat_merge_criteria([], $patch);
        $context['lastQuestion'] = null;
    } elseif ($category === 'PROFILE_UPDATE') {
        $context['mode'] = 'profile_edit';
        $context['temporaryCriteria'] = [];
        $context['lastQuestion'] = null;
    } else {
        $target = $context['lastQuestion']['target'] ?? $context['mode'];
        if (in_array($target, ['chat', 'general_search', 'profile_edit'], true)) $context['mode'] = $target;
        if ($context['mode'] === 'chat' && $patch) $context['mode'] = 'general_search';
        if ($context['mode'] === 'general_search') {
            $context['temporaryCriteria'] = chat_merge_criteria($context['temporaryCriteria'], $patch);
        }
    }
    $context['lastCategory'] = $category;
    $profilePatch = $patch;
    unset($profilePatch['nearMe']);
    return [
        'category' => $category,
        'context' => $context,
        'criteria' => $context['mode'] === 'general_search' ? $context['temporaryCriteria'] : [],
        'profilePatch' => $profilePatch,
        'allowProfileUpdate' => $context['mode'] === 'profile_edit' && count($profilePatch) > 0,
    ];
}

/** Point unique d'écriture du profil depuis le chat, après résolution de la destination. */
function chat_commit_turn(string $userId, array $turn, string $reply, string $questionField): array
{
    $context = $turn['context'];
    $context['forceNextProfileEdit'] = false;
    $context['lastQuestion'] = $questionField === 'none' ? null : [
        'text' => mb_substr($reply, 0, 2000), 'target' => $context['mode'], 'field' => $questionField,
    ];
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $updatedProfile = null;
        if ($turn['allowProfileUpdate']) {
            // Relire le profil ici conserve les apprentissages des swipes survenus pendant l'appel LLM.
            $sql = 'SELECT data FROM selix_docs WHERE user_id = ? AND kind = ?';
            if ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql') $sql .= ' FOR UPDATE';
            $raw = q($sql, [$userId, 'profile'])->fetchColumn();
            $profile = $raw ? json_decode((string) $raw) : new stdClass();
            $updatedProfile = chat_merge_criteria(is_object($profile) ? get_object_vars($profile) : [], $turn['profilePatch']);
            q('REPLACE INTO selix_docs (user_id, kind, data) VALUES (?, ?, ?)', [
                $userId, 'profile', json_encode($updatedProfile, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            ]);
        }
        chat_save_context($userId, $context);
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
    return ['conversationContext' => chat_context_response($context), 'profile' => $updatedProfile];
}
