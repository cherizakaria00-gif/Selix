# Image de l'API Selix pour un hébergeur de conteneurs (Railway, Render…).
# La configuration vient des variables d'environnement (voir config.env.php).
# Dépendances PHP installées au build : vendor/ n'est pas versionné.
FROM composer:2 AS deps
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --optimize-autoloader --no-interaction --ignore-platform-reqs

FROM php:8.3-apache

RUN docker-php-ext-install pdo_mysql \
    && a2enmod rewrite \
    && sed -ri 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf \
    && { echo 'upload_max_filesize=12M'; echo 'post_max_size=14M'; } > /usr/local/etc/php/conf.d/selix.ini

# Les hébergeurs imposent le port via $PORT.
RUN sed -ri 's/Listen 80/Listen ${PORT}/' /etc/apache2/ports.conf \
    && sed -ri 's/<VirtualHost \*:80>/<VirtualHost *:${PORT}>/' /etc/apache2/sites-available/000-default.conf
ENV PORT=8080 SELIX_CONFIG=/var/www/html/config.env.php

COPY --chown=www-data:www-data . /var/www/html/
COPY --from=deps --chown=www-data:www-data /app/vendor /var/www/html/vendor
RUN rm -f /var/www/html/config.php && mkdir -p /var/www/html/uploads && chown -R www-data:www-data /var/www/html/uploads

EXPOSE 8080

# Sur Railway, uploads/ est un volume (photos conservées entre déploiements) monté
# en root : on le rend inscriptible par Apache et on y remet sa protection.
RUN cp /var/www/html/uploads/.htaccess /usr/local/share/uploads.htaccess
CMD ["sh", "-c", "cp /usr/local/share/uploads.htaccess /var/www/html/uploads/.htaccess && chown -R www-data:www-data /var/www/html/uploads && exec apache2-foreground"]
