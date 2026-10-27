<?php
/**
 * Notifications push via le service Expo (https://exp.host) : un seul appel HTTP
 * couvre iOS (APNs) et Android (FCM). Les identifiants APNs/FCM sont configurés
 * côté EAS (`eas credentials`), pas ici.
 */

declare(strict_types=1);

require_once __DIR__ . '/match.php';

function format_price(array $p): string
{
    $price = number_format((float) $p['price'], 0, ',', ' ') . ' MAD';
    return $p['transaction'] === 'location' ? "$price / mois" : $price;
}

/** Prévient chaque client dont le profil correspond au bien qui vient d'être publié. */
function notify_new_property(array $property): int
{
    if ($property['status'] !== 'disponible') return 0;
    $rows = q(
        "SELECT t.token, t.user_id, d.data AS profile FROM selix_push_tokens t
         JOIN selix_users u ON u.id = t.user_id AND u.role = 'user'
         LEFT JOIN selix_docs d ON d.user_id = t.user_id AND d.kind = 'profile'",
    )->fetchAll();
    $disliked = array_flip(q(
        "SELECT user_id FROM selix_swipes WHERE property_id = ? AND action = 'dislike'",
        [$property['id']],
    )->fetchAll(PDO::FETCH_COLUMN));

    $messages = [];
    foreach ($rows as $row) {
        if (isset($disliked[$row['user_id']]) || !$row['profile']) continue;
        $score = score_property(json_decode($row['profile'], true) ?: [], $property);
        if ($score < MATCH_THRESHOLD) continue;
        $messages[] = [
            'to' => $row['token'],
            'title' => "Nouveau bien pour vous — $score% compatible",
            'body' => "{$property['title']} · {$property['district']}, {$property['city']} · " . format_price($property),
            'data' => ['propertyId' => $property['id'], 'kind' => 'match'],
            'sound' => 'default',
            'channelId' => 'matches',
        ];
    }
    foreach (array_chunk($messages, 100) as $chunk) send_expo_push($chunk);
    return count($messages);
}

/** « samedi 31 octobre à 10:00 », à l'heure du Maroc. */
function format_visit_fr(int $ms): string
{
    $d = (new DateTimeImmutable('@' . intdiv($ms, 1000)))->setTimezone(new DateTimeZone('Africa/Casablanca'));
    $days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    $months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    return sprintf('%s %d %s à %s', $days[(int) $d->format('w')], (int) $d->format('j'), $months[(int) $d->format('n') - 1], $d->format('H:i'));
}

/** Prévient le client quand Selix confirme ou annule sa visite. */
function notify_visit(string $userId, array $property, int $visitAt, string $status): int
{
    if ($status === 'demandée') return 0;
    $tokens = q('SELECT token FROM selix_push_tokens WHERE user_id = ?', [$userId])->fetchAll(PDO::FETCH_COLUMN);
    if (!$tokens) return 0;
    $when = format_visit_fr($visitAt);
    [$title, $body] = $status === 'confirmée'
        ? ['Visite confirmée', "{$property['title']} · $when. Un commercial Selix vous y attend."]
        : ['Visite annulée', "Votre visite de {$property['title']} prévue $when est annulée. Vous pouvez en demander une autre."];
    send_expo_push(array_map(fn($t) => [
        'to' => $t, 'title' => $title, 'body' => $body, 'sound' => 'default', 'channelId' => 'matches',
        'data' => ['propertyId' => $property['id'], 'kind' => 'visit'],
    ], $tokens));
    return count($tokens);
}

function send_expo_push(array $messages): void
{
    $ch = curl_init(config('expo_push_url') ?: 'https://exp.host/--/api/v2/push/send');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
        CURLOPT_POSTFIELDS => json_encode($messages, JSON_UNESCAPED_UNICODE),
    ]);
    $res = json_decode((string) curl_exec($ch), true);

    // Appareil désinstallé ou token révoqué : on l'oublie.
    foreach ($res['data'] ?? [] as $i => $ticket) {
        if (($ticket['details']['error'] ?? null) === 'DeviceNotRegistered' && isset($messages[$i])) {
            q('DELETE FROM selix_push_tokens WHERE token = ?', [$messages[$i]['to']]);
        }
    }
}
