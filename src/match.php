<?php
/**
 * Score de compatibilité 0–100, copie fidèle de scoreProperty() dans
 * selix/src/services/ai.ts (sans la distance). Sert à décider à qui envoyer
 * la notification « nouveau bien pour vous ». Si vous modifiez l'un, modifiez l'autre.
 */

declare(strict_types=1);

const MATCH_THRESHOLD = 65;

function clampf(float $v, float $min, float $max): float
{
    return min($max, max($min, $v));
}

function score_property(array $profile, array $p): int
{
    $s = 50.0;
    $l = $profile['learned'] ?? [];
    $cities = $profile['cities'] ?? [];
    $types = $profile['types'] ?? [];
    $budgetMax = $profile['budgetMax'] ?? null;
    $budgetMin = $profile['budgetMin'] ?? null;
    $price = (float) $p['price'];

    if (!empty($profile['transaction'])) $s += $profile['transaction'] === $p['transaction'] ? 10 : -45;

    if ($budgetMax) {
        if ($price <= $budgetMax) $s += 15;
        else $s -= min(40, ($price / $budgetMax - 1) * 80);
    }
    if ($budgetMin && $price < $budgetMin * 0.7) $s -= 5;

    $liked = $l['likedPrice'][$p['transaction']] ?? null;
    if (!$budgetMax && $liked && $liked['n'] >= 2 && $liked['sum'] > 0 && $price > 0) {
        $ratio = $price / ($liked['sum'] / $liked['n']);
        if ($ratio > 0.7 && $ratio < 1.3) $s += 8;
        else $s -= min(15, abs(log($ratio)) * 15);
    }

    if ($cities) $s += in_array($p['city'], $cities, true) ? 15 : -40;
    if (!empty($profile['districts']) && in_array($p['district'], $profile['districts'], true)) $s += 8;
    $s += clampf(($l['cities'][$p['city']] ?? 0) * 4, -10, 10)
        + clampf(($l['districts'][$p['district']] ?? 0) * 3, -8, 8);

    if ($types) {
        if (in_array($p['type'], $types, true)) $s += 10;
        elseif ($p['type'] === 'studio' && in_array('appartement', $types, true)) $s -= 8;
        else $s -= 30;
    }
    $s += clampf(($l['types'][$p['type']] ?? 0) * 4, -10, 10);

    $bedroomsMin = $profile['bedroomsMin'] ?? null;
    if ($bedroomsMin) {
        if ($p['bedrooms'] >= $bedroomsMin) $s += 6;
        else $s -= 12 * ($bedroomsMin - $p['bedrooms']);
    }

    foreach ($profile['mustHave'] ?? [] as $f) $s += in_array($f, $p['features'], true) ? 5 : -8;
    $learnedFeatures = 0.0;
    foreach ($p['features'] as $f) $learnedFeatures += $l['features'][$f] ?? 0;
    $s += clampf($learnedFeatures * 2, -10, 12);

    if ($p['status'] !== 'disponible') $s -= 30;

    return (int) round(clampf($s, 0, 100));
}
