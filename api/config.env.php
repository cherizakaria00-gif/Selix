<?php
// Configuration lue depuis l'environnement, pour les hébergeurs de conteneurs.
// Railway fournit MYSQLHOST, MYSQLPORT, MYSQLDATABASE, MYSQLUSER, MYSQLPASSWORD
// quand une base MySQL est liée au service ; DB_DSN/DB_USER/DB_PASSWORD/DB_SSL_CA les remplacent
// (base externe, ex. MySQL managé DigitalOcean).
$env = fn(string $k, ?string $default = null) => ($v = getenv($k)) !== false && $v !== '' ? $v : $default;

return [
    // 'db' => [
    //     'dsn' => $env('DB_DSN') ?? sprintf(
    //         'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
    //         $env('MYSQLHOST', 'localhost'),
    //         $env('MYSQLPORT', '3306'),
    //         $env('MYSQLDATABASE', 'selix'),
    //     ),
    //     'user' => $env('DB_USER') ?? $env('MYSQLUSER'),
    //     'password' => $env('DB_PASSWORD') ?? $env('MYSQLPASSWORD'),
    //     // Contenu PEM du certificat CA de la base (DigitalOcean : « Download CA certificate »).
    //     // Contenu PEM, chemin d'un fichier .crt, ou REQUIRED (chiffré sans vérification).
    //     'ssl_ca' => ($ca = $env('DB_SSL_CA')) && is_file($ca) ? file_get_contents($ca) : $ca,
    //     'ssl_verify' => $env('DB_SSL_VERIFY') !== '0',
    // ],
    'db' => [
            'dsn' => 'sqlite:selix-local.sqlite',
            'user' => null,
            'password' => null,
       ],
    'public_url' => $env('PUBLIC_URL', ''),
    // Space DigitalOcean pour les photos (sinon elles vont dans uploads/, effacé à chaque déploiement).
    // SPACES_ENDPOINT ne sert qu'aux tests (ex. MinIO) ; SPACES_CDN_URL par défaut : CDN du Space.
    'spaces' => [
        'key' => $env('SPACES_KEY'),
        'secret' => $env('SPACES_SECRET'),
        'bucket' => $env('SPACES_BUCKET'),
        'region' => $env('SPACES_REGION', 'fra1'),
        'endpoint' => $env('SPACES_ENDPOINT'),
        'cdn_url' => $env('SPACES_CDN_URL'),
    ],
    'gemini_api_key' => $env('GEMINI_API_KEY', ''),
    'anthropic_api_key' => $env('ANTHROPIC_API_KEY', ''),
    'seed_users' => [
        ['id' => 'u-admin', 'name' => 'Admin Selix', 'email' => 'admin@selix.ma', 'phone' => '+212600000000', 'role' => 'admin', 'password' => $env('SEED_ADMIN_PASSWORD', bin2hex(random_bytes(16)))],
        ['id' => 'u-demo', 'name' => 'Client Démo', 'email' => 'client@selix.ma', 'phone' => '+212611111111', 'role' => 'user', 'password' => $env('SEED_CLIENT_PASSWORD', bin2hex(random_bytes(16)))],
    ],
];
