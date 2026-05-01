#!/bin/bash

DOCKER_COMPOSE_FILES=(-f dist/docker-compose.yml -f dist/docker-compose-prod.yml)
REQUIRE_LETSENCRYPT=True
GENERATE_SELF_SIGNED=False
LETSENCRYPT_DOMAIN="technochat.org"

ARGS=("$@")


print_help() {
    echo "$0 builds required docker images and restarts the running containers"
    echo -e "\tdefault:\trun in production mode"
    echo -e "\t--dev:\trun in developer mode"
    echo -e "\t--rc:\trun in RC mode with Let's Encrypt certificate for rc.technochat.org"
    echo -e "\t--help:\tprints this text and exits"
}

compose() {
    docker compose "${DOCKER_COMPOSE_FILES[@]}" "$@"
}

while [ "$1" != "" ]; do
    case $1 in
        "--dev")
            DOCKER_COMPOSE_FILES=(-f dist/docker-compose.yml -f dist/docker-compose-dev.yml)
            REQUIRE_LETSENCRYPT=False
            GENERATE_SELF_SIGNED=True
            ;;
        "--rc")
            DOCKER_COMPOSE_FILES=(-f dist/docker-compose.yml -f dist/docker-compose-rc.yml)
            LETSENCRYPT_DOMAIN="rc.technochat.org"
            ;;
        "--help") print_help; exit 0;;
    esac
    shift
done

# generating selfsigned ssl certificates
if [ "$GENERATE_SELF_SIGNED" = True ] && { [ ! -f certs/server.key ] || [ ! -f certs/server.crt ]; }; then
    mkdir certs
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 -subj "/C=US" \
        -keyout certs/server.key -out certs/server.crt || exit
fi

if [ "$REQUIRE_LETSENCRYPT" = True ]; then
    cert_path="/etc/letsencrypt/live/$LETSENCRYPT_DOMAIN/fullchain.pem"
    key_path="/etc/letsencrypt/live/$LETSENCRYPT_DOMAIN/privkey.pem"

    if [ ! -f "$cert_path" ] || [ ! -f "$key_path" ]; then
        echo "error: deploy requires Let's Encrypt certificates for $LETSENCRYPT_DOMAIN"
        echo "       expected $cert_path"
        echo "       expected $key_path"
        echo "       use ./deploy.sh --dev for local self-signed deployment"
        exit 1
    fi

    if ! openssl x509 -checkend 0 -noout -in "$cert_path"; then
        echo "error: Let's Encrypt certificate for $LETSENCRYPT_DOMAIN is expired"
        echo "       renew it before deploy: certbot renew --cert-name $LETSENCRYPT_DOMAIN"
        exit 1
    fi
fi

compose build  || exit
compose down   || exit
compose up -d  || exit

echo "done"
