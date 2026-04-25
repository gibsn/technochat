# Technochat

Technochat is a small self-hosted service for temporary communication:
- one-time text messages with optional images and TTL;
- temporary browser chats over WebSocket.

The backend is written in Go, stores data in Redis, and is typically run behind Nginx with Docker Compose.

## What the application does

The project exposes HTTP API endpoints and static pages for three main scenarios:
- create a message with text, optional images, and a TTL;
- open a message by link and delete it after reading;
- create a temporary chat room with a limited number of participants.

Default local service ports in the dev stack:
- `80` and `443` for Nginx;
- internal `8080` for the Go application;
- internal `6379` for Redis.

## How to run locally

### Requirements

- Go `1.18+`
- Node.js `22+` and `npm`
- Docker with Docker Compose
- `openssl` for generating local self-signed certificates

### Developer mode with Docker Compose

The simplest way to run the project locally is the bundled dev stack:

```bash
chmod +x ./deploy.sh
./deploy.sh --dev
```

What this command does:
- generates local certificates in `certs/` if they do not exist yet;
- builds containers from `dist/docker-compose-dev.yml`;
- starts Redis, the Go application, and Nginx.

After startup, open [https://127.0.0.1](https://127.0.0.1) in the browser.

To stop or restart the environment manually, use Docker Compose with `dist/docker-compose-dev.yml`.

## How to test

If `Makefile` is available, the main entry points are:
- `make lint` for static analysis;
- `make test` for the full test suite.

### Full test run

UI tests depend on the local dev stack, so first install browser dependencies and start the application:

```bash
npm --prefix ui-tests ci
npm --prefix ui-tests exec playwright install chromium webkit
./deploy.sh --dev
make test
```

`make test` runs:
- `make go-tests` for Go unit tests;
- `make integration-tests` for integration tests;
- `make ui-tests` for Playwright UI checks.

### Targeted test commands

Use these when a narrower check is enough:

```bash
make go-tests
make integration-tests
make ui-tests
```

## Automatic deploy

For automatic deploy, define `GITHUB_TOKEN`, `TG_BOT_TOKEN`, and `TG_CHAT_ID` in `/etc/default/autodeploy_technochat`:

```bash
GITHUB_TOKEN=github_pat...
TG_BOT_TOKEN=123456:ABCDEF...
TG_CHAT_ID=-1001234567890
```

Then run:

```bash
make install_autodeploy
```

## Let's Encrypt certificates

For production certificates:

```bash
mkdir /srv/letsencrypt
sudo certbot certonly \
  --webroot -w /srv/letsencrypt \
  -d technochat.org -d www.technochat.org \
  --deploy-hook "docker exec nginx nginx -s reload"
```
