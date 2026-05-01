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

## Security model

One-time messages and temporary chat message bodies are encrypted in the browser
before they are sent to the Go backend.

For temporary chats, the room creator generates an AES-GCM-128 room key in the
browser. The key is added to the invitation URL fragment as `#key=...`, so it is
not sent in HTTP requests or WebSocket URLs. Every chat message is encrypted with
that room key and a fresh random IV before `WebSocket.send`. The server assigns
participant names, enforces the join limit, and relays WebSocket JSON, but it
only sees ciphertext for user message bodies.

This protects past chat contents from later server-side storage access and keeps
message text out of normal server request handling, logs, and relay logic. It
does not protect against a compromised server changing the JavaScript delivered
to browsers, malicious invitation-link recipients, browser/device compromise, or
the server replacing client code during a live session. Temporary chat service
events such as join/leave notifications and generated participant names are
metadata and are not encrypted.

The current chat bootstrap uses a shared symmetric room key carried in the
invitation link. It does not provide participant key authentication or forward
secrecy; adding authenticated participant keys is the next step if the server
itself must be unable to perform key-substitution attacks.

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
- builds containers from `dist/docker-compose.yml` and `dist/docker-compose-dev.yml`;
- starts Redis, the Go application, and Nginx.

After startup, open [https://127.0.0.1](https://127.0.0.1) in the browser.

For the RC environment, use the RC mode. It expects a valid Let's Encrypt certificate
for `rc.technochat.org`:

```bash
./deploy.sh --rc
```

To stop or restart the environment manually, use Docker Compose with the base
file and the environment override:

```bash
docker compose -f dist/docker-compose.yml -f dist/docker-compose-dev.yml down
docker compose -f dist/docker-compose.yml -f dist/docker-compose-dev.yml up -d
```

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
- `make ui-unit-tests` for Playwright checks with mocked browser dependencies;
- `make ui-e2e-tests` for Playwright checks against the running dev stack.

### Targeted test commands

Use these when a narrower check is enough:

```bash
make go-tests
make integration-tests
make ui-unit-tests
make ui-e2e-tests
make ui-tests
```

The current UI coverage map and the next recommended test cases are documented in `ui-tests/TEST_PLAN.md`.

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

Production and RC deployments use Let's Encrypt certificates mounted into the
Nginx container. The certificate challenge must be issued with the `webroot`
authenticator because ports `80` and `443` are already served by the application
Nginx container.

Create the shared challenge directory first:

```bash
mkdir -p /srv/letsencrypt
```

For production certificates:

```bash
sudo certbot certonly \
  --webroot -w /srv/letsencrypt \
  -d technochat.org -d www.technochat.org \
  --deploy-hook "docker exec nginx nginx -s reload"
```

For RC certificates:

```bash
sudo certbot certonly \
  --webroot -w /srv/letsencrypt \
  -d rc.technochat.org \
  --cert-name rc.technochat.org \
  --deploy-hook "docker exec nginx nginx -s reload"
```

The Docker Compose configs mount `/srv/letsencrypt` into the Nginx container as
`/var/www/letsencrypt`, and the Nginx configs serve
`/.well-known/acme-challenge/` from that directory.

Check automatic renewal:

```bash
systemctl status certbot.timer
certbot renew --dry-run
```

The renewal config should use `webroot`, not the `nginx` authenticator:

```bash
grep -E "authenticator|webroot|installer" /etc/letsencrypt/renewal/rc.technochat.org.conf
```

If the deploy hook is missing, add one so the container reloads certificates
after successful renewal:

```bash
cat >/etc/letsencrypt/renewal-hooks/deploy/reload-technochat-nginx.sh <<'EOF'
#!/bin/sh
docker exec nginx nginx -s reload
EOF

chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-technochat-nginx.sh
```
