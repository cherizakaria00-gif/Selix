<?php
// Copiez ce fichier en config.php (jamais versionné) et remplissez-le.
return [
    // Hostinger : hPanel → Bases de données → MySQL. L'hôte est « localhost » depuis l'hébergement.
    'db' => [
        'dsn' => 'mysql:host=localhost;dbname=u262891370_selixapp;charset=utf8mb4',
        'user' => 'u262891370_selixapp',
        'password' => '',
    ],
    // URL publique de ce dossier (sert à construire l'URL des photos envoyées).
    'public_url' => 'https://votre-domaine.ma/api',
    // Clé API Claude (console.anthropic.com). Reste sur le serveur, jamais dans l'app.
    'anthropic_api_key' => '',
    // Clé Gemini pour la transcription audio (ou variable serveur GEMINI_API_KEY).
    'gemini_api_key' => '',
    // Comptes créés au premier lancement (mots de passe hachés en base, puis inutiles ici).
    'seed_users' => [
        ['id' => 'u-admin', 'name' => 'Admin Selix', 'email' => 'admin@selix.ma', 'phone' => '+212600000000', 'role' => 'admin', 'password' => 'CHANGEZ-MOI'],
        ['id' => 'u-demo', 'name' => 'Client Démo', 'email' => 'client@selix.ma', 'phone' => '+212611111111', 'role' => 'user', 'password' => 'Client123!'],
    ],
];
