#!/bin/bash

DOCKER_COMPOSE_CFG="dist/docker-compose.yml"

ARGS=("$@")


print_help() {
    echo "$0 builds required docker images and restarts the running containers"
    echo -e "\t--dev:\trun in developer mode"
    echo -e "\t--help:\tprints this text and exits"
}


while [ "$1" != "" ]; do
    case $1 in
        "--dev") DOCKER_COMPOSE_CFG="dist/docker-compose-dev.yml";;
        "--help") print_help; exit 0;;
    esac
    shift
done

# generating selfsigned ssl certificates
if [ ! -f certs/server.key ] || [ ! -f certs/server.crt ]; then
    mkdir certs
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 -subj "/C=US" \
        -keyout certs/server.key -out certs/server.crt || exit
fi

docker-compose -f $DOCKER_COMPOSE_CFG build  || exit
docker-compose -f $DOCKER_COMPOSE_CFG down   || exit
docker-compose -f $DOCKER_COMPOSE_CFG up -d  || exit

echo "done"
