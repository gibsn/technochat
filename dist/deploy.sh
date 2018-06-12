#!/bin/bash

# generating selfsigned ssl certificates
if [ ! -f certs/server.key ] || [ ! -f certs/server.crt ]; then
    mkdir certs
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 -subj "/C=US" \
        -keyout certs/server.key -out certs/server.crt || exit
fi

# building docker images from source
docker build ./ -f dist/technochat.dockerfile -t gibsn/technochat || exit
docker build ./ -f dist/nginx.dockerfile -t gibsn/nginx || exit
docker build ./ -f dist/redis.dockerfile -t gibsn/redis || exit

docker-compose -f dist/docker-compose.yml restart || exit

echo "done"
