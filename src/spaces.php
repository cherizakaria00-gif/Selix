<?php
/**
 * Stockage des photos dans un Space DigitalOcean (API compatible S3), pour qu'elles
 * survivent aux redéploiements : le disque des conteneurs App Platform est éphémère.
 * Requête PUT signée en AWS Signature V4, sans SDK.
 */

declare(strict_types=1);

/** Config du Space si elle est complète, sinon null (les photos restent dans uploads/). */
function spaces_config(): ?array
{
    $c = config('spaces') ?: [];
    foreach (['key', 'secret', 'bucket', 'region'] as $k) {
        if (empty($c[$k])) return null;
    }
    return $c;
}

/** Envoie le fichier en lecture publique et renvoie son URL publique (CDN du Space). */
function spaces_put(array $c, string $file, string $objectKey, string $mime): string
{
    $endpoint = rtrim($c['endpoint'] ?: "https://{$c['region']}.digitaloceanspaces.com", '/');
    $host = (string) parse_url($endpoint, PHP_URL_HOST) . (($port = parse_url($endpoint, PHP_URL_PORT)) ? ":$port" : '');
    $path = '/' . rawurlencode($c['bucket']) . '/' . implode('/', array_map('rawurlencode', explode('/', $objectKey)));
    $payloadHash = hash_file('sha256', $file);
    $amzDate = gmdate('Ymd\THis\Z');
    $day = substr($amzDate, 0, 8);

    $headers = [
        'cache-control' => 'public, max-age=31536000, immutable',
        'content-type' => $mime,
        'host' => $host,
        'x-amz-acl' => 'public-read',
        'x-amz-content-sha256' => $payloadHash,
        'x-amz-date' => $amzDate,
    ];
    $signedHeaders = implode(';', array_keys($headers));
    $canonical = implode("\n", [
        'PUT', $path, '',
        implode('', array_map(fn($k, $v) => "$k:$v\n", array_keys($headers), $headers)),
        $signedHeaders, $payloadHash,
    ]);
    $scope = "$day/{$c['region']}/s3/aws4_request";
    $toSign = implode("\n", ['AWS4-HMAC-SHA256', $amzDate, $scope, hash('sha256', $canonical)]);
    $kSigning = 'AWS4' . $c['secret'];
    foreach ([$day, $c['region'], 's3', 'aws4_request'] as $part) $kSigning = hash_hmac('sha256', $part, $kSigning, true);
    $headers['authorization'] = "AWS4-HMAC-SHA256 Credential={$c['key']}/$scope, SignedHeaders=$signedHeaders, Signature="
        . hash_hmac('sha256', $toSign, $kSigning);

    $fh = fopen($file, 'rb');
    $ch = curl_init($endpoint . $path);
    curl_setopt_array($ch, [
        CURLOPT_PUT => true,
        CURLOPT_INFILE => $fh,
        CURLOPT_INFILESIZE => filesize($file),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_HTTPHEADER => array_map(fn($k, $v) => "$k: $v", array_keys($headers), $headers),
    ]);
    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    fclose($fh);
    if ($status !== 200) {
        error_log("Spaces PUT $path : HTTP $status " . curl_error($ch) . ' ' . substr((string) $body, 0, 500));
        throw new HttpError(502, "Impossible d'enregistrer la photo.");
    }

    $base = $c['cdn_url'] ?: "https://{$c['bucket']}.{$c['region']}.cdn.digitaloceanspaces.com";
    return rtrim($base, '/') . '/' . $objectKey;
}
