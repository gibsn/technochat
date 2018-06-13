#!/bin/bash

# generating selfsigned ssl certificates
if [ ! -f certs/server.key ] || [ ! -f certs/server.crt ]; then
    mkdir certs
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 -subj "/C=US" \
        -keyout certs/server.key -out certs/server.crt || exit
fi

docker-compose -f dist/docker-compose.yml build  || exit
docker-compose -f dist/docker-compose.yml down   || exit
docker-compose -f dist/docker-compose.yml up -d  || exit

echo "done"
