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
require __DIR__ . '/src/transcribe.php';
require __DIR__ . '/src/spaces.php';

const TRANSACTIONS = ['location', 'achat'];
const PROPERTY_TYPES = ['appartement', 'villa', 'studio', 'riad', 'bureau', 'terrain'];
const PROPERTY_STATUSES = ['disponible', 'réservé', 'vendu'];
const SWIPE_ACTIONS = ['like', 'dislike', 'superlike'];
const LEAD_KINDS = ['like', 'visite', 'contact'];
const LEAD_STATUSES = ['nouveau', 'contacté', 'visite planifiée', 'clôturé'];
const DOC_KINDS = ['profile', 'chat', 'seen'];
const APPROVALS = ['validé', 'en attente', 'refusé'];
const VISIT_STATUSES = ['demandée', 'confirmée', 'annulée'];
const VISIT_MAX_DAYS = 90;
/** Une visite dure environ une heure : deux visites confirmées sur un même bien ne se chevauchent pas. */
const VISIT_DURATION_MS = 3_600_000;

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Authorization, Content-Type, ngrok-skip-browser-warning');
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

/** Un bien sans champ « approval » (créé avant les promoteurs) est un bien Selix validé. */
function approval_of(array $p): string
{
    return $p['approval'] ?? 'validé';
}

function is_owner(?array $viewer, array $p): bool
{
    return $viewer !== null && ($p['ownerId'] ?? null) === $viewer['id'];
}

/**
 * Biens que ce visiteur a le droit de voir : le super admin voit tout, un promoteur voit
 * les siens (même en attente) et les biens publiés, tous les autres seulement les biens
 * publiés. Le propriétaire et l'état de validation ne sont montrés qu'à qui doit les voir.
 */
function visible_properties(?array $viewer): array
{
    $admin = $viewer !== null && $viewer['role'] === 'admin';
    $out = [];
    foreach (all_properties() as $p) {
        $mine = is_owner($viewer, $p);
        if (!$admin && !$mine && approval_of($p) !== 'validé') continue;
        if (!$admin && !$mine) unset($p['ownerId'], $p['approval'], $p['rejectionReason']);
        $out[] = $p;
    }
    return $out;
}

/** Biens qu'un compte gère : tous pour le super admin, les siens pour un promoteur. */
function managed_properties(array $user): array
{
    return array_values(array_filter(
        all_properties(),
        fn($p) => $user['role'] === 'admin' || is_owner($user, $p),
    ));
}

function save_property(array $p): void
{
    q('REPLACE INTO selix_properties (id, data, created_at) VALUES (?, ?, ?)', [$p['id'], json_encode($p, JSON_UNESCAPED_UNICODE), $p['createdAt']]);
}

/** Les clients ne peuvent aimer ou demander une visite que pour un bien publié. */
function find_live_property(string $id): ?array
{
    $p = find_property($id);
    return $p && approval_of($p) === 'validé' ? $p : null;
}

function default_agent_phone(): string
{
    return (string) (config('default_agent_phone') ?: '+212522000000');
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
    $base = 'SELECT l.*, u.name AS c_name, u.phone AS c_phone, u.email AS c_email
             FROM selix_leads l LEFT JOIN selix_users u ON u.id = l.user_id';
    $rows = match ($user['role']) {
        'admin' => q("$base ORDER BY l.created_at DESC")->fetchAll(),
        // Un commercial ne voit que les leads que le super admin lui a assignés.
        'commercial' => q("$base WHERE l.assigned_to = ? ORDER BY l.created_at DESC", [$user['id']])->fetchAll(),
        // Un promoteur n'accède jamais aux coordonnées des clients : voir /stats/properties.
        'promoteur' => [],
        default => q("$base WHERE l.user_id = ? ORDER BY l.created_at DESC", [$user['id']])->fetchAll(),
    };
    $staff = in_array($user['role'], ['admin', 'commercial'], true);
    return array_map(function ($r) use ($staff) {
        $lead = [
            'id' => $r['id'], 'userId' => $r['user_id'], 'propertyId' => $r['property_id'], 'kind' => $r['kind'],
            'status' => $r['status'], 'note' => $r['note'], 'createdAt' => (int) $r['created_at'],
            'visitAt' => $r['visit_at'] === null ? null : (int) $r['visit_at'], 'visitStatus' => $r['visit_status'],
        ];
        if ($staff) {
            $lead['assignedTo'] = $r['assigned_to'];
            $lead['client'] = ['name' => $r['c_name'] ?? 'Client supprimé', 'phone' => $r['c_phone'] ?? '', 'email' => $r['c_email'] ?? ''];
        }
        return array_filter($lead, fn($v) => $v !== null);
    }, $rows);
}

/** Date de visite en millisecondes : à venir, à l'heure ou à la demie, pendant les heures d'ouverture (Maroc). */
function clean_visit_at(mixed $v): int
{
    if (!is_int($v) && !is_float($v) && !(is_string($v) && ctype_digit($v))) throw new HttpError(400, 'Date de visite invalide.');
    $ms = (int) $v;
    $now = now_ms();
    if ($ms < $now + 3_600_000) throw new HttpError(400, 'Choisissez un créneau dans le futur (au moins une heure à l’avance).');
    if ($ms > $now + VISIT_MAX_DAYS * 86_400_000) throw new HttpError(400, 'Choisissez une date dans les ' . VISIT_MAX_DAYS . ' prochains jours.');
    if ($ms % 1_800_000 !== 0) throw new HttpError(400, 'Une visite commence à l’heure pile ou à la demie.');
    $hour = (int) (new DateTimeImmutable('@' . intdiv($ms, 1000)))->setTimezone(new DateTimeZone('Africa/Casablanca'))->format('G');
    if ($hour < 8 || $hour >= 20) throw new HttpError(400, 'Les visites ont lieu entre 8 h et 20 h.');
    return $ms;
}

/** Une visite est déjà confirmée sur ce bien à moins d'une heure de ce créneau (hors lead $exceptLeadId) ? */
function visit_clash(string $propertyId, int $at, string $exceptLeadId = ''): bool
{
    return (bool) q(
        "SELECT 1 FROM selix_leads WHERE property_id = ? AND id <> ? AND visit_status = 'confirmée' AND visit_at > ? AND visit_at < ?",
        [$propertyId, $exceptLeadId, $at - VISIT_DURATION_MS, $at + VISIT_DURATION_MS],
    )->fetchColumn();
}

/** Crée le lead d'un client, ou fait remonter l'existant si la demande est plus forte qu'un like. */
function upsert_lead(string $userId, string $propertyId, string $kind, ?string $note = null, ?int $visitAt = null): void
{
    $existing = q('SELECT id FROM selix_leads WHERE user_id = ? AND property_id = ?', [$userId, $propertyId])->fetchColumn();
    if (!$existing) {
        q('INSERT INTO selix_leads (id, user_id, property_id, kind, status, note, created_at, visit_at, visit_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [new_id('l'), $userId, $propertyId, $kind, 'nouveau', $note, now_ms(), $visitAt, $visitAt === null ? null : 'demandée']);
    } elseif ($kind !== 'like') {
        // Une nouvelle date remplace l'ancienne et repasse la visite « demandée » (à reconfirmer).
        q("UPDATE selix_leads SET kind = ?, status = 'nouveau', note = COALESCE(?, note), created_at = ?,
              visit_at = COALESCE(?, visit_at), visit_status = CASE WHEN ? IS NULL THEN visit_status ELSE 'demandée' END WHERE id = ?",
            [$kind, $note, now_ms(), $visitAt, $visitAt, $existing]);
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
                if ((int) ($row['disabled'] ?? 0)) throw new HttpError(403, 'Ce compte est désactivé. Contactez Selix.');
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

        // --- Comptes du personnel (commerciaux, promoteurs) : réservé au super admin ---
        case ['POST', 'users', 1]:
            require_admin();
            $email = strtolower(str_field($in, 'email', 190));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw new HttpError(400, 'Adresse email invalide.');
            $password = (string) ($in['password'] ?? '');
            if (mb_strlen($password) < 8) throw new HttpError(400, 'Le mot de passe doit faire au moins 8 caractères.');
            if (q('SELECT 1 FROM selix_users WHERE email = ?', [$email])->fetchColumn()) throw new HttpError(409, 'Un compte existe déjà avec cet email.');
            $row = [
                'id' => new_id('u'), 'name' => str_field($in, 'name', 190), 'email' => $email,
                'phone' => str_field($in, 'phone', 40, false), 'role' => enum_field($in, 'role', STAFF_ROLES),
                'disabled' => 0, 'created_at' => now_ms(),
            ];
            q('INSERT INTO selix_users (id, name, email, phone, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$row['id'], $row['name'], $email, $row['phone'], password_hash($password, PASSWORD_DEFAULT), $row['role'], $row['created_at']]);
            return public_user($row);
        case ['PATCH', 'users', 2]:
            $admin = require_admin();
            $row = q('SELECT * FROM selix_users WHERE id = ?', [$id])->fetch() ?: throw new HttpError(404, 'Compte introuvable.');
            // On ne touche ni aux clients ni au super admin (pas de risque de se verrouiller dehors).
            if (!in_array($row['role'], STAFF_ROLES, true)) throw new HttpError(403, 'Seuls les comptes du personnel sont modifiables.');
            $name = array_key_exists('name', $in) ? str_field($in, 'name', 190) : $row['name'];
            $phone = array_key_exists('phone', $in) ? str_field($in, 'phone', 40, false) : $row['phone'];
            $role = array_key_exists('role', $in) ? enum_field($in, 'role', STAFF_ROLES) : $row['role'];
            $disabled = array_key_exists('disabled', $in) ? (int) (bool) $in['disabled'] : (int) $row['disabled'];
            q('UPDATE selix_users SET name = ?, phone = ?, role = ?, disabled = ? WHERE id = ?', [$name, $phone, $role, $disabled, $id]);
            if (!empty($in['password'])) {
                if (mb_strlen((string) $in['password']) < 8) throw new HttpError(400, 'Le mot de passe doit faire au moins 8 caractères.');
                q('UPDATE selix_users SET password_hash = ? WHERE id = ?', [password_hash((string) $in['password'], PASSWORD_DEFAULT), $id]);
                q('DELETE FROM selix_tokens WHERE user_id = ?', [$id]);
            }
            // Un compte désactivé est déconnecté partout, et un commercial qui n'en est plus un
            // rend ses leads : ils retournent dans la liste « à assigner ».
            if ($disabled) q('DELETE FROM selix_tokens WHERE user_id = ?', [$id]);
            if ($disabled || $role !== 'commercial') q('UPDATE selix_leads SET assigned_to = NULL WHERE assigned_to = ?', [$id]);
            return public_user(q('SELECT * FROM selix_users WHERE id = ?', [$id])->fetch());

        // --- Biens : lecture publique des biens publiés, écriture admin et promoteurs ---
        case ['GET', 'properties', 1]:
            return visible_properties(current_user());
        case ['PUT', 'properties', 2]:
            $u = require_role('admin', 'promoteur');
            $existing = find_property($id);
            if ($u['role'] === 'promoteur' && $existing && !is_owner($u, $existing)) throw new HttpError(403, 'Ce bien ne vous appartient pas.');
            $p = clean_property($id, $in, $existing);
            if ($u['role'] === 'promoteur') {
                // Le contact reste celui de Selix ; un bien neuf ou modifié repasse en validation
                // (un simple changement de statut disponible / réservé / vendu n'en a pas besoin).
                $p['agentPhone'] = $existing['agentPhone'] ?? default_agent_phone();
                $p['ownerId'] = $u['id'];
                $content = fn(array $x) => array_diff_key($x, ['status' => 1, 'approval' => 1, 'rejectionReason' => 1]);
                if (!$existing || $content($p) != $content($existing)) {
                    $p['approval'] = 'en attente';
                } else {
                    $p['approval'] = approval_of($existing);
                    if (isset($existing['rejectionReason'])) $p['rejectionReason'] = $existing['rejectionReason'];
                }
            } else {
                foreach (['ownerId', 'approval', 'rejectionReason'] as $k) if (isset($existing[$k])) $p[$k] = $existing[$k];
                if (!$existing) $p['approval'] = 'validé';
            }
            save_property($p);
            // Un bien publié, ou qui redevient disponible : on prévient les clients concernés.
            $wasLive = $existing && approval_of($existing) === 'validé';
            if (approval_of($p) === 'validé' && (!$wasLive || ($existing['status'] !== 'disponible' && $p['status'] === 'disponible'))) {
                after_response(fn() => notify_new_property($p));
            }
            return visible_properties($u);
        case ['POST', 'properties', 3]:
            if ($seg[2] !== 'approval') break;
            $u = require_admin();
            $p = find_property($id) ?: throw new HttpError(404, 'Bien introuvable.');
            $approval = enum_field($in, 'approval', ['validé', 'refusé']);
            $wasLive = approval_of($p) === 'validé';
            $p['approval'] = $approval;
            $reason = str_field($in, 'reason', 500, false);
            if ($approval === 'refusé' && $reason !== '') $p['rejectionReason'] = $reason;
            else unset($p['rejectionReason']);
            save_property($p);
            if ($approval === 'validé' && !$wasLive) after_response(fn() => notify_new_property($p));
            return visible_properties($u);
        case ['DELETE', 'properties', 2]:
            $u = require_role('admin', 'promoteur');
            $existing = find_property($id);
            if ($existing && $u['role'] === 'promoteur' && !is_owner($u, $existing)) throw new HttpError(403, 'Ce bien ne vous appartient pas.');
            q('DELETE FROM selix_properties WHERE id = ?', [$id]);
            return visible_properties($u);

        // Statistiques par bien, sans aucune donnée client : pour les promoteurs (leurs biens) et le super admin.
        case ['GET', 'stats', 2]:
            if ($id !== 'properties') break;
            $u = require_role('admin', 'promoteur');
            $stats = [];
            foreach (managed_properties($u) as $p) $stats[$p['id']] = ['propertyId' => $p['id'], 'views' => 0, 'likes' => 0, 'superlikes' => 0, 'visits' => 0];
            foreach (q("SELECT property_id, COUNT(*) AS views,
                               SUM(CASE WHEN action <> 'dislike' THEN 1 ELSE 0 END) AS likes,
                               SUM(CASE WHEN action = 'superlike' THEN 1 ELSE 0 END) AS superlikes
                        FROM selix_swipes GROUP BY property_id")->fetchAll() as $r) {
                if (isset($stats[$r['property_id']])) {
                    $stats[$r['property_id']] = array_merge($stats[$r['property_id']], [
                        'views' => (int) $r['views'], 'likes' => (int) $r['likes'], 'superlikes' => (int) $r['superlikes'],
                    ]);
                }
            }
            foreach (q("SELECT property_id, COUNT(*) AS n FROM selix_leads WHERE kind = 'visite' GROUP BY property_id")->fetchAll() as $r) {
                if (isset($stats[$r['property_id']])) $stats[$r['property_id']]['visits'] = (int) $r['n'];
            }
            return array_values($stats);

        case ['POST', 'photos', 1]:
            $u = require_role('admin', 'promoteur');
            if ($u['role'] === 'promoteur') rate_limit('photo:' . $u['id'], 150, 3600);
            return handle_upload();

        // --- Swipes & leads ---
        case ['GET', 'swipes', 1]:
            return swipes_for(current_user());
        case ['POST', 'swipes', 1]:
            $u = require_user();
            $action = enum_field($in, 'action', SWIPE_ACTIONS);
            $propertyId = str_field($in, 'propertyId', 64);
            if (!find_live_property($propertyId)) throw new HttpError(404, 'Bien introuvable.');
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
            if (!find_live_property($propertyId)) throw new HttpError(404, 'Bien introuvable.');
            $note = str_field($in, 'note', 1000, false);
            $kind = enum_field($in, 'kind', LEAD_KINDS);
            $visitAt = $kind === 'visite' && isset($in['visitAt']) ? clean_visit_at($in['visitAt']) : null;
            if ($visitAt !== null && visit_clash($propertyId, $visitAt)) throw new HttpError(409, 'Ce créneau n’est plus disponible, choisissez-en un autre.');
            upsert_lead($u['id'], $propertyId, $kind, $note === '' ? null : $note, $visitAt);
            return leads_for($u);
        case ['PATCH', 'leads', 2]:
            $u = require_role('admin', 'commercial', 'user');
            $lead = q('SELECT * FROM selix_leads WHERE id = ?', [$id])->fetch() ?: throw new HttpError(404, 'Lead introuvable.');

            // Un client ne gère que sa propre visite : la replanifier ou l'annuler.
            if ($u['role'] === 'user') {
                if ($lead['user_id'] !== $u['id']) throw new HttpError(403, 'Ce lead n’est pas le vôtre.');
                if (isset($in['visitAt'])) {
                    $at = clean_visit_at($in['visitAt']);
                    if (visit_clash($lead['property_id'], $at, $id)) throw new HttpError(409, 'Ce créneau n’est plus disponible, choisissez-en un autre.');
                    q("UPDATE selix_leads SET kind = 'visite', visit_at = ?, visit_status = 'demandée', status = 'nouveau' WHERE id = ?", [$at, $id]);
                } elseif (($in['visitStatus'] ?? null) === 'annulée' && $lead['visit_at'] !== null) {
                    q("UPDATE selix_leads SET visit_status = 'annulée' WHERE id = ?", [$id]);
                } else {
                    throw new HttpError(400, 'Rien à modifier.');
                }
                return leads_for($u);
            }

            if ($u['role'] === 'commercial' && $lead['assigned_to'] !== $u['id']) throw new HttpError(403, 'Ce lead ne vous est pas assigné.');
            if (isset($in['status'])) q('UPDATE selix_leads SET status = ? WHERE id = ?', [enum_field($in, 'status', LEAD_STATUSES), $id]);
            if (isset($in['note'])) q('UPDATE selix_leads SET note = ? WHERE id = ?', [str_field($in, 'note', 1000, false), $id]);
            if (array_key_exists('assignedTo', $in)) {
                if ($u['role'] !== 'admin') throw new HttpError(403, "Seul le super admin assigne les leads.");
                $to = $in['assignedTo'];
                if ($to !== null) {
                    $ok = q("SELECT 1 FROM selix_users WHERE id = ? AND role = 'commercial' AND disabled = 0", [(string) $to])->fetchColumn();
                    if (!$ok) throw new HttpError(400, 'Commercial introuvable ou désactivé.');
                }
                q('UPDATE selix_leads SET assigned_to = ? WHERE id = ?', [$to, $id]);
            }
            // Visite : confirmer, déplacer (nouvelle heure = confirmée) ou annuler ; le client est prévenu.
            if (isset($in['visitAt']) || isset($in['visitStatus'])) {
                $visitStatus = isset($in['visitStatus']) ? enum_field($in, 'visitStatus', VISIT_STATUSES) : 'confirmée';
                $at = isset($in['visitAt']) ? clean_visit_at($in['visitAt']) : ($lead['visit_at'] === null ? null : (int) $lead['visit_at']);
                if ($at === null) throw new HttpError(400, 'Aucune date de visite à confirmer.');
                if ($visitStatus === 'confirmée' && visit_clash($lead['property_id'], $at, $id)) {
                    throw new HttpError(409, 'Une autre visite est déjà confirmée sur ce bien à ce moment-là.');
                }
                q('UPDATE selix_leads SET visit_at = ?, visit_status = ? WHERE id = ?', [$at, $visitStatus, $id]);
                if ($visitStatus === 'confirmée') q("UPDATE selix_leads SET status = 'visite planifiée' WHERE id = ? AND status IN ('nouveau', 'contacté')", [$id]);
                $property = find_property($lead['property_id']);
                if ($property && ($visitStatus !== $lead['visit_status'] || $at !== (int) $lead['visit_at'])) {
                    after_response(fn() => notify_visit($lead['user_id'], $property, $at, $visitStatus));
                }
            }
            return leads_for($u);

        // Créneaux déjà pris sur un bien (visites confirmées), pour griser le calendrier du client.
        case ['GET', 'properties', 3]:
            if ($seg[2] !== 'busy') break;
            require_user();
            if (!find_live_property($id)) throw new HttpError(404, 'Bien introuvable.');
            return array_map('intval', q("SELECT visit_at FROM selix_leads WHERE property_id = ? AND visit_status = 'confirmée' AND visit_at > ?", [$id, now_ms()])->fetchAll(PDO::FETCH_COLUMN));

        case ['POST', 'me', 2]:
            if ($id !== 'password') break;
            $u = require_user();
            rate_limit('pwd:' . $u['id'], 10, 900);
            $row = q('SELECT * FROM selix_users WHERE id = ?', [$u['id']])->fetch();
            if (!password_verify((string) ($in['current'] ?? ''), $row['password_hash'])) throw new HttpError(401, 'Mot de passe actuel incorrect.');
            $new = (string) ($in['next'] ?? '');
            $min = $u['role'] === 'user' ? 6 : 8;
            if (mb_strlen($new) < $min) throw new HttpError(400, "Le nouveau mot de passe doit faire au moins $min caractères.");
            q('UPDATE selix_users SET password_hash = ? WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $u['id']]);
            // Les autres appareils connectés sont déconnectés ; celui-ci reste ouvert.
            q('DELETE FROM selix_tokens WHERE user_id = ? AND token_hash <> ?', [$u['id'], hash('sha256', (string) bearer_token())]);
            return ['ok' => true];

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

        // Ajout de la transcription audio, avec la même authentification que le chat.
        case ['POST', 'transcribe', 1]:
            return handle_transcription(require_user());
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
    $mime = $ext === 'jpg' ? 'image/jpeg' : ($ext === 'heic' ? 'image/heic' : "image/$ext");
    $name = date('Ym') . '-' . bin2hex(random_bytes(12)) . '.' . $ext;
    if ($spaces = spaces_config()) return ['url' => spaces_put($spaces, $file['tmp_name'], "photos/$name", $mime)];
    // Sans Space configuré (tests locaux, Hostinger) : disque local.
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
