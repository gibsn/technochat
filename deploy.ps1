# generating selfsigned ssl certificates
if (!(Test-Path ./certs/server.key) -or -!(Test-Path ./certs/server.crt)) {
    mkdir certs
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 -subj "/C=US" -keyout ./certs/server.key -out ./certs/server.crt
}

docker-compose -f dist/docker-compose.yml build
docker-compose -f dist/docker-compose.yml down
docker-compose -f dist/docker-compose.yml up -d
Read-Host
echo "done"
