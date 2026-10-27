<?php
/**
 * Outils communs de l'API Selix : base de données, JSON, authentification.
 * Compatible MySQL/MariaDB (Hostinger) et SQLite (tests locaux).
 */

declare(strict_types=1);

final class HttpError extends Exception
{
    public function __construct(public int $status, string $message)
    {
        parent::__construct($message);
    }
}

function config(?string $key = null): mixed
{
    static $config = null;
    if ($config === null) {
        $file = getenv('SELIX_CONFIG') ?: dirname(__DIR__) . '/config.php';
        if (!is_file($file)) throw new HttpError(500, 'config.php manquant sur le serveur.');
        $config = require $file;
    }
    return $key === null ? $config : ($config[$key] ?? null);
}

function now_ms(): int
{
    return (int) floor(microtime(true) * 1000);
}

function new_id(string $prefix): string
{
    return $prefix . '-' . base_convert((string) now_ms(), 10, 36) . '-' . bin2hex(random_bytes(4));
}

// ---------- Base de données ----------

const SCHEMA_VERSION = 3;

/** Comptes créés et gérés par le super admin (les clients s'inscrivent seuls, l'admin vient du seed). */
const STAFF_ROLES = ['commercial', 'promoteur'];

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    $c = config('db');
    $options = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ];
    // Bases managées (DigitalOcean…) : connexion TLS vérifiée avec leur certificat d'autorité.
    if (strtoupper((string) ($c['ssl_ca'] ?? '')) === 'REQUIRED') {
        // Équivalent de sslmode=REQUIRED : chiffré, sans vérifier le certificat du serveur.
        $options[PDO::MYSQL_ATTR_SSL_CA] = '/etc/ssl/certs/ca-certificates.crt';
        $options[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = false;
    } elseif (!empty($c['ssl_ca'])) {
        $caFile = sys_get_temp_dir() . '/selix-db-ca.pem';
        if (!is_file($caFile)) file_put_contents($caFile, $c['ssl_ca']);
        $options[PDO::MYSQL_ATTR_SSL_CA] = $caFile;
        // À n'utiliser que si l'on se connecte par une IP absente du certificat.
        if (($c['ssl_verify'] ?? true) === false) $options[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = false;
    }
    $pdo = new PDO($c['dsn'], $c['user'] ?? null, $c['password'] ?? null, $options);
    migrate($pdo);
    return $pdo;
}

function migrate(PDO $pdo): void
{
    try {
        $v = (int) $pdo->query('SELECT v FROM selix_meta')->fetchColumn();
        if ($v >= SCHEMA_VERSION) return;
    } catch (PDOException) {
        // Première installation.
    }
    $statements = [
        'CREATE TABLE IF NOT EXISTS selix_meta (v INT NOT NULL PRIMARY KEY)',
        'CREATE TABLE IF NOT EXISTS selix_users (
            id VARCHAR(64) PRIMARY KEY, name VARCHAR(190) NOT NULL, email VARCHAR(190) NOT NULL UNIQUE,
            phone VARCHAR(40) NOT NULL, password_hash VARCHAR(255) NOT NULL, role VARCHAR(10) NOT NULL,
            created_at BIGINT NOT NULL)',
        'CREATE TABLE IF NOT EXISTS selix_tokens (
            token_hash CHAR(64) PRIMARY KEY, user_id VARCHAR(64) NOT NULL, created_at BIGINT NOT NULL)',
        'CREATE TABLE IF NOT EXISTS selix_properties (
            id VARCHAR(64) PRIMARY KEY, data MEDIUMTEXT NOT NULL, created_at BIGINT NOT NULL)',
        'CREATE TABLE IF NOT EXISTS selix_swipes (
            user_id VARCHAR(64) NOT NULL, property_id VARCHAR(64) NOT NULL, action VARCHAR(10) NOT NULL,
            at BIGINT NOT NULL, PRIMARY KEY (user_id, property_id))',
        'CREATE TABLE IF NOT EXISTS selix_leads (
            id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(64) NOT NULL, property_id VARCHAR(64) NOT NULL,
            kind VARCHAR(10) NOT NULL, status VARCHAR(30) NOT NULL, note TEXT NULL, created_at BIGINT NOT NULL)',
        // Profil IA, historique du chat et biens déjà notifiés : un document JSON par utilisateur.
        'CREATE TABLE IF NOT EXISTS selix_docs (
            user_id VARCHAR(64) NOT NULL, kind VARCHAR(16) NOT NULL, data MEDIUMTEXT NOT NULL,
            PRIMARY KEY (user_id, kind))',
        'CREATE TABLE IF NOT EXISTS selix_push_tokens (
            token VARCHAR(255) PRIMARY KEY, user_id VARCHAR(64) NOT NULL, created_at BIGINT NOT NULL)',
        'CREATE TABLE IF NOT EXISTS selix_rate (
            k VARCHAR(190) PRIMARY KEY, start BIGINT NOT NULL, n INT NOT NULL)',
    ];
    foreach ($statements as $sql) $pdo->exec($sql);

    // Colonnes ajoutées après la v1 (v2 : comptes désactivables, leads assignés ; v3 : date de visite).
    // MySQL n'a pas de « ADD COLUMN IF NOT EXISTS » : toute la liste est rejouée à chaque montée de
    // version, et l'erreur « colonne déjà présente » des étapes déjà appliquées est ignorée.
    foreach ([
        'ALTER TABLE selix_users ADD COLUMN disabled TINYINT NOT NULL DEFAULT 0',
        'ALTER TABLE selix_leads ADD COLUMN assigned_to VARCHAR(64) NULL',
        // v3 : visite demandée par le client (date + heure) et son état.
        'ALTER TABLE selix_leads ADD COLUMN visit_at BIGINT NULL',
        'ALTER TABLE selix_leads ADD COLUMN visit_status VARCHAR(12) NULL',
    ] as $sql) {
        try {
            $pdo->exec($sql);
        } catch (PDOException $e) {
            if (!str_contains(strtolower($e->getMessage()), 'duplicate column')) throw $e;
        }
    }

    if (!(int) $pdo->query('SELECT COUNT(*) FROM selix_users')->fetchColumn()) seed($pdo);
    $pdo->exec('DELETE FROM selix_meta');
    $pdo->exec('INSERT INTO selix_meta (v) VALUES (' . SCHEMA_VERSION . ')');
}

function seed(PDO $pdo): void
{
    $insert = $pdo->prepare('INSERT INTO selix_users (id, name, email, phone, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    foreach (config('seed_users') ?? [] as $u) {
        $insert->execute([$u['id'], $u['name'], strtolower($u['email']), $u['phone'], password_hash($u['password'], PASSWORD_DEFAULT), $u['role'], now_ms()]);
    }
    $props = json_decode((string) file_get_contents(__DIR__ . '/seed-properties.json'), true) ?: [];
    $insert = $pdo->prepare('INSERT INTO selix_properties (id, data, created_at) VALUES (?, ?, ?)');
    foreach ($props as $p) $insert->execute([$p['id'], json_encode($p, JSON_UNESCAPED_UNICODE), $p['createdAt']]);
}

function q(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st;
}

// ---------- Requête / réponse ----------

function body(): array
{
    static $body = null;
    if ($body === null) {
        $raw = file_get_contents('php://input') ?: '';
        $body = $raw === '' ? [] : json_decode($raw, true);
        if (!is_array($body)) throw new HttpError(400, 'Corps JSON invalide.');
    }
    return $body;
}

function send_json(mixed $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

/** Limite simple par fenêtre fixe (anti brute-force / anti abus du LLM). */
function rate_limit(string $key, int $max, int $windowSec): void
{
    $now = now_ms();
    $row = q('SELECT start, n FROM selix_rate WHERE k = ?', [$key])->fetch();
    if ($row && $now - (int) $row['start'] < $windowSec * 1000) {
        if ((int) $row['n'] >= $max) throw new HttpError(429, 'Trop de tentatives, réessayez dans quelques minutes.');
        q('UPDATE selix_rate SET n = n + 1 WHERE k = ?', [$key]);
    } else {
        q('REPLACE INTO selix_rate (k, start, n) VALUES (?, ?, 1)', [$key, $now]);
    }
}

// ---------- Authentification ----------

function public_user(array $row): array
{
    return [
        'id' => $row['id'],
        'name' => $row['name'],
        'email' => $row['email'],
        'phone' => $row['phone'],
        'role' => $row['role'],
        'disabled' => (bool) ($row['disabled'] ?? 0),
        'createdAt' => (int) $row['created_at'],
    ];
}

function issue_token(string $userId): string
{
    $token = bin2hex(random_bytes(32));
    q('INSERT INTO selix_tokens (token_hash, user_id, created_at) VALUES (?, ?, ?)', [hash('sha256', $token), $userId, now_ms()]);
    return $token;
}

function bearer_token(): ?string
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($header === '' && function_exists('getallheaders')) {
        foreach (getallheaders() as $k => $v) if (strtolower($k) === 'authorization') $header = $v;
    }
    return preg_match('/^Bearer\s+([a-f0-9]{64})$/i', trim($header), $m) ? strtolower($m[1]) : null;
}

/** Utilisateur connecté, ou null si la requête est anonyme. */
function current_user(): ?array
{
    static $user = false;
    if ($user !== false) return $user;
    $token = bearer_token();
    $row = $token ? q(
        'SELECT u.* FROM selix_tokens t JOIN selix_users u ON u.id = t.user_id WHERE t.token_hash = ? AND u.disabled = 0',
        [hash('sha256', $token)],
    )->fetch() : null;
    return $user = $row ? public_user($row) : null;
}

function require_user(): array
{
    return current_user() ?? throw new HttpError(401, 'Session expirée, reconnectez-vous.');
}

function require_admin(): array
{
    $u = require_user();
    if ($u['role'] !== 'admin') throw new HttpError(403, 'Réservé aux administrateurs.');
    return $u;
}

/** Connecté avec l'un des rôles donnés (« admin » est le super admin). */
function require_role(string ...$roles): array
{
    $u = require_user();
    if (!in_array($u['role'], $roles, true)) throw new HttpError(403, 'Accès refusé.');
    return $u;
}
