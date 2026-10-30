# Schulserver (Variante B): Nginx liefert die fertige Datei aus release/ aus.
# Kein Build im Container nötig, darum auch ohne Internet baubar,
# sobald das Basis-Image einmal vorhanden ist.
FROM nginx:1.27-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY release/leyonet.html /usr/share/nginx/html/index.html

EXPOSE 80
