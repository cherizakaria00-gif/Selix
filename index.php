<?php
/**
 * API REST de l'app mobile Selix. Toutes les réponses sont en JSON ;
 * l'authentification se fait par jeton « Authorization: Bearer <token> ».
 */

declare(strict_types=1);

// Une erreur PHP affichée casserait le JSON : elles vont dans le journal du serveur.
ini_set('display_errors', '0');

require __DIR__ . '/vendor/autoload.php';
require __DIR__ . '/src/lib.php';
require __DIR__ . '/src/push.php';
require __DIR__ . '/src/chat.php';

const TRANSACTIONS = ['location', 'achat'];
const PROPERTY_TYPES = ['appartement', 'villa', 'studio', 'riad', 'bureau', 'terrain'];
const PROPERTY_STATUSES = ['disponible', 'réservé', 'vendu'];
const SWIPE_ACTIONS = ['like', 'dislike', 'superlike'];
const LEAD_KINDS = ['like', 'visite', 'contact'];
const LEAD_STATUSES = ['nouveau', 'contacté', 'visite planifiée', 'clôturé'];
const DOC_KINDS = ['profile', 'chat', 'seen'];

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;

// ---------- Lecture / validation ----------

function all_properties(): array
{
    return array_map(
        fn($r) => json_decode($r['data'], true),
        q('SELECT data FROM selix_properties ORDER BY created_at DESC')->fetchAll(),
    );
}

function find_property(string $id): ?array
{
    $data = q('SELECT data FROM selix_properties WHERE id = ?', [$id])->fetchColumn();
    return $data ? json_decode($data, true) : null;
}

function str_field(array $in, string $key, int $max, bool $required = true): string
{
    $v = trim((string) ($in[$key] ?? ''));
    if ($required && $v === '') throw new HttpError(400, "Champ « $key » requis.");
    return mb_substr($v, 0, $max);
}

function enum_field(array $in, string $key, array $allowed): string
{
    $v = $in[$key] ?? null;
    if (!in_array($v, $allowed, true)) throw new HttpError(400, "Valeur invalide pour « $key ».");
    return $v;
}

function clean_property(string $id, array $in, ?array $existing): array
{
    $images = array_values(array_filter(
        is_array($in['images'] ?? null) ? $in['images'] : [],
        // Photos embarquées dans l'app ou envoyées sur le serveur : jamais d'URI locale d'un téléphone.
        fn($u) => is_string($u) && preg_match('#^(local:[\w-]+|https?://\S+)$#', $u),
    ));
    $p = [
        'id' => $id,
        'title' => str_field($in, 'title', 160),
        'transaction' => enum_field($in, 'transaction', TRANSACTIONS),
        'type' => enum_field($in, 'type', PROPERTY_TYPES),
        'city' => str_field($in, 'city', 80),
        'district' => str_field($in, 'district', 80),
        'price' => max(0, (float) ($in['price'] ?? 0)),
        'surface' => max(0, (float) ($in['surface'] ?? 0)),
        'bedrooms' => max(0, (int) ($in['bedrooms'] ?? 0)),
        'bathrooms' => max(0, (int) ($in['bathrooms'] ?? 0)),
        'features' => array_values(array_unique(array_map(
            fn($f) => mb_substr(trim((string) $f), 0, 40),
            array_filter(is_array($in['features'] ?? null) ? $in['features'] : [], 'is_string'),
        ))),
        'description' => str_field($in, 'description', 5000, false),
        'latitude' => (float) ($in['latitude'] ?? 0),
        'longitude' => (float) ($in['longitude'] ?? 0),
        'images' => array_slice($images, 0, 20),
        'status' => enum_field($in, 'status', PROPERTY_STATUSES),
        'agentPhone' => str_field($in, 'agentPhone', 40, false),
        'createdAt' => $existing['createdAt'] ?? now_ms(),
    ];
    foreach (['standing' => 60, 'delivery' => 120] as $k => $max) {
        $v = str_field($in, $k, $max, false);
        if ($v !== '') $p[$k] = $v;
    }
    if (abs($p['latitude']) > 90 || abs($p['longitude']) > 180) throw new HttpError(400, 'Position GPS invalide.');
    return $p;
}

function swipes_for(?array $user): array
{
    if (!$user) return [];
    $rows = $user['role'] === 'admin'
        ? q('SELECT * FROM selix_swipes')->fetchAll()
        : q('SELECT * FROM selix_swipes WHERE user_id = ?', [$user['id']])->fetchAll();
    return array_map(fn($r) => [
        'userId' => $r['user_id'], 'propertyId' => $r['property_id'], 'action' => $r['action'], 'at' => (int) $r['at'],
    ], $rows);
}

function leads_for(?array $user): array
{
    if (!$user) return [];
    $rows = $user['role'] === 'admin'
        ? q('SELECT * FROM selix_leads ORDER BY created_at DESC')->fetchAll()
        : q('SELECT * FROM selix_leads WHERE user_id = ? ORDER BY created_at DESC', [$user['id']])->fetchAll();
    return array_map(fn($r) => array_filter([
        'id' => $r['id'], 'userId' => $r['user_id'], 'propertyId' => $r['property_id'], 'kind' => $r['kind'],
        'status' => $r['status'], 'note' => $r['note'], 'createdAt' => (int) $r['created_at'],
    ], fn($v) => $v !== null), $rows);
}

/** Crée le lead d'un client, ou fait remonter l'existant si la demande est plus forte qu'un like. */
function upsert_lead(string $userId, string $propertyId, string $kind, ?string $note = null): void
{
    $existing = q('SELECT id FROM selix_leads WHERE user_id = ? AND property_id = ?', [$userId, $propertyId])->fetchColumn();
    if (!$existing) {
        q('INSERT INTO selix_leads (id, user_id, property_id, kind, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [new_id('l'), $userId, $propertyId, $kind, 'nouveau', $note, now_ms()]);
    } elseif ($kind !== 'like') {
        q("UPDATE selix_leads SET kind = ?, status = 'nouveau', note = COALESCE(?, note), created_at = ? WHERE id = ?",
            [$kind, $note, now_ms(), $existing]);
    }
}

// ---------- Routes ----------

function route(string $method, string $path): mixed
{
    $seg = $path === '' ? [] : explode('/', $path);
    $id = isset($seg[1]) ? rawurldecode($seg[1]) : null;
    $in = in_array($method, ['POST', 'PUT', 'PATCH'], true) && !str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'multipart/') ? body() : [];

    switch ([$method, $seg[0] ?? '', count($seg)]) {
        case ['GET', '', 0]:
            return ['name' => 'Selix API', 'ok' => true];

        // --- Auth ---
        case ['POST', 'auth', 2]:
            if ($id === 'login') {
                $email = strtolower(trim((string) ($in['email'] ?? '')));
                rate_limit('login:' . ($_SERVER['REMOTE_ADDR'] ?? '') . ':' . $email, 10, 900);
                $row = q('SELECT * FROM selix_users WHERE email = ?', [$email])->fetch();
                if (!$row || !password_verify((string) ($in['password'] ?? ''), $row['password_hash'])) {
                    throw new HttpError(401, 'Email ou mot de passe incorrect.');
                }
                if (password_needs_rehash($row['password_hash'], PASSWORD_DEFAULT)) {
                    q('UPDATE selix_users SET password_hash = ? WHERE id = ?', [password_hash($in['password'], PASSWORD_DEFAULT), $row['id']]);
                }
                return ['token' => issue_token($row['id']), 'user' => public_user($row)];
            }
            if ($id === 'register') {
                rate_limit('register:' . ($_SERVER['REMOTE_ADDR'] ?? ''), 10, 3600);
                $email = strtolower(str_field($in, 'email', 190));
                if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw new HttpError(400, 'Adresse email invalide.');
                $password = (string) ($in['password'] ?? '');
                if (mb_strlen($password) < 6) throw new HttpError(400, 'Le mot de passe doit faire au moins 6 caractères.');
                if (q('SELECT 1 FROM selix_users WHERE email = ?', [$email])->fetchColumn()) {
                    throw new HttpError(409, 'Un compte existe déjà avec cet email.');
                }
                $row = [
                    'id' => new_id('u'), 'name' => str_field($in, 'name', 190), 'email' => $email,
                    'phone' => str_field($in, 'phone', 40, false), 'role' => 'user', 'created_at' => now_ms(),
                ];
                q('INSERT INTO selix_users (id, name, email, phone, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [$row['id'], $row['name'], $email, $row['phone'], password_hash($password, PASSWORD_DEFAULT), 'user', $row['created_at']]);
                return ['token' => issue_token($row['id']), 'user' => public_user($row)];
            }
            if ($id === 'logout') {
                $token = bearer_token();
                if ($token) q('DELETE FROM selix_tokens WHERE token_hash = ?', [hash('sha256', $token)]);
                return ['ok' => true];
            }
            break;
        case ['GET', 'me', 1]:
            return require_user();

        case ['GET', 'users', 1]:
            $u = current_user();
            if (($u['role'] ?? null) !== 'admin') return [];
            return array_map('public_user', q('SELECT * FROM selix_users ORDER BY created_at')->fetchAll());

        // --- Biens (lecture publique, écriture admin) ---
        case ['GET', 'properties', 1]:
            return all_properties();
        case ['PUT', 'properties', 2]:
            require_admin();
            $existing = find_property($id);
            $p = clean_property($id, $in, $existing);
            q('REPLACE INTO selix_properties (id, data, created_at) VALUES (?, ?, ?)', [$id, json_encode($p, JSON_UNESCAPED_UNICODE), $p['createdAt']]);
            // Nouveau bien, ou bien qui redevient disponible : on prévient les clients concernés.
            if (!$existing || ($existing['status'] !== 'disponible' && $p['status'] === 'disponible')) {
                after_response(fn() => notify_new_property($p));
            }
            return all_properties();
        case ['DELETE', 'properties', 2]:
            require_admin();
            q('DELETE FROM selix_properties WHERE id = ?', [$id]);
            return all_properties();

        case ['POST', 'photos', 1]:
            require_admin();
            return handle_upload();

        // --- Swipes & leads ---
        case ['GET', 'swipes', 1]:
            return swipes_for(current_user());
        case ['POST', 'swipes', 1]:
            $u = require_user();
            $action = enum_field($in, 'action', SWIPE_ACTIONS);
            $propertyId = str_field($in, 'propertyId', 64);
            if (!find_property($propertyId)) throw new HttpError(404, 'Bien introuvable.');
            q('REPLACE INTO selix_swipes (user_id, property_id, action, at) VALUES (?, ?, ?, ?)', [$u['id'], $propertyId, $action, now_ms()]);
            // Un like = un lead pour l'équipe commerciale.
            if ($action !== 'dislike') upsert_lead($u['id'], $propertyId, 'like');
            return swipes_for($u);
        case ['DELETE', 'swipes', 1]:
            $u = require_user();
            q('DELETE FROM selix_swipes WHERE user_id = ?', [$u['id']]);
            return swipes_for($u);

        case ['GET', 'leads', 1]:
            return leads_for(current_user());
        case ['POST', 'leads', 1]:
            $u = require_user();
            $propertyId = str_field($in, 'propertyId', 64);
            if (!find_property($propertyId)) throw new HttpError(404, 'Bien introuvable.');
            $note = str_field($in, 'note', 1000, false);
            upsert_lead($u['id'], $propertyId, enum_field($in, 'kind', LEAD_KINDS), $note === '' ? null : $note);
            return leads_for($u);
        case ['PATCH', 'leads', 2]:
            $u = require_admin();
            if (isset($in['status'])) q('UPDATE selix_leads SET status = ? WHERE id = ?', [enum_field($in, 'status', LEAD_STATUSES), $id]);
            if (isset($in['note'])) q('UPDATE selix_leads SET note = ? WHERE id = ?', [str_field($in, 'note', 1000, false), $id]);
            return leads_for($u);

        // --- Profil IA, chat, biens déjà vus : documents JSON propres à l'utilisateur ---
        case ['GET', 'me', 2]:
        case ['PUT', 'me', 2]:
            $u = require_user();
            if (!in_array($id, DOC_KINDS, true)) break;
            if ($method === 'GET') {
                $data = q('SELECT data FROM selix_docs WHERE user_id = ? AND kind = ?', [$u['id'], $id])->fetchColumn();
                return $data ? json_decode($data) : null;
            }
            // Décodage en objets : les {} vides du profil ne doivent pas devenir des [].
            $doc = json_decode((string) file_get_contents('php://input'));
            $json = json_encode($doc->data ?? null, JSON_UNESCAPED_UNICODE);
            if (strlen($json) > 500_000) throw new HttpError(413, 'Document trop volumineux.');
            q('REPLACE INTO selix_docs (user_id, kind, data) VALUES (?, ?, ?)', [$u['id'], $id, $json]);
            return ['ok' => true];

        case ['POST', 'push-tokens', 1]:
            $u = require_user();
            $token = str_field($in, 'token', 255);
            if (!preg_match('/^Expo(nent)?PushToken\[[\w-]+\]$/', $token)) throw new HttpError(400, 'Token push invalide.');
            q('REPLACE INTO selix_push_tokens (token, user_id, created_at) VALUES (?, ?, ?)', [$token, $u['id'], now_ms()]);
            return ['ok' => true];
        case ['DELETE', 'push-tokens', 2]:
            $u = require_user();
            q('DELETE FROM selix_push_tokens WHERE token = ? AND user_id = ?', [$id, $u['id']]);
            return ['ok' => true];

        case ['POST', 'chat', 1]:
            return handle_chat(require_user());
    }
    throw new HttpError(404, 'Route inconnue.');
}

function handle_upload(): array
{
    $file = $_FILES['file'] ?? null;
    if (!$file || $file['error'] !== UPLOAD_ERR_OK) throw new HttpError(400, 'Aucune photo reçue.');
    if ($file['size'] > 12 * 1024 * 1024) throw new HttpError(413, 'Photo trop lourde (12 Mo max).');
    $ext = [
        'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/heic' => 'heic', 'image/heif' => 'heic',
    ][(new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name'])] ?? null;
    if (!$ext) throw new HttpError(415, 'Format accepté : JPEG, PNG, WebP ou HEIC.');
    $name = date('Ym') . '-' . bin2hex(random_bytes(12)) . '.' . $ext;
    if (!move_uploaded_file($file['tmp_name'], __DIR__ . '/uploads/' . $name)) throw new HttpError(500, "Impossible d'enregistrer la photo.");
    return ['url' => rtrim((string) config('public_url'), '/') . '/uploads/' . $name];
}

/** Exécute une tâche après avoir rendu la réponse (envoi des push sans faire attendre l'admin). */
function after_response(callable $task): void
{
    $GLOBALS['selix_after'][] = $task;
}

// ---------- Point d'entrée ----------

$path = trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');
$base = trim(dirname($_SERVER['SCRIPT_NAME'] ?? ''), '/');
if ($base !== '' && str_starts_with($path, $base)) $path = trim(substr($path, strlen($base)), '/');
if (str_starts_with($path, 'index.php')) $path = trim(substr($path, 9), '/');

try {
    send_json(route($_SERVER['REQUEST_METHOD'], $path));
} catch (HttpError $e) {
    send_json(['error' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
    error_log('Selix API: ' . $e);
    send_json(['error' => 'Erreur serveur.'], 500);
}

if (!empty($GLOBALS['selix_after'])) {
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    elseif (function_exists('litespeed_finish_request')) litespeed_finish_request();
    foreach ($GLOBALS['selix_after'] as $task) {
        try {
            $task();
        } catch (Throwable $e) {
            error_log('Selix push: ' . $e);
        }
    }
}
