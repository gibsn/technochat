# Technochat

## Run tests locally
Recommended: use `make test` to run the full test suite.
UI tests use Playwright and the local dev stack from `deploy.sh --dev`.

Dependencies:
- Go 1.18+
- Node.js 22+ and npm
- Docker with Docker Compose

Install UI test dependencies:
```bash
npm --prefix ui-tests ci
npm --prefix ui-tests exec playwright install chromium webkit
```

Run the local dev stack:
```bash
chmod +x ./deploy.sh
./deploy.sh --dev
```

Run the full test suite after the dev stack is up:
```bash
make test
```

Use targeted commands only when you need a narrower check.

Run only Go unit tests:
```bash
make go-tests
```

Run only UI regressions:
```bash
make ui-tests
```

## Set up automatic deploy
Define GITHUB_TOKEN, TG_BOT_TOKEN and TG_CHAT_ID in /etc/default/autodeploy_technochat:
```
GITHUB_TOKEN=github_pat...
TG_BOT_TOKEN=123456:ABCDEF...
TG_CHAT_ID=-1001234567890
```

Call `make install_autodeploy`

## Set up letsencrypt certs
```
mkdir /srv/letsencrypt
sudo certbot certonly \
  --webroot -w /srv/letsencrypt \
  -d technochat.org -d www.technochat.org \
  --deploy-hook "docker exec nginx nginx -s reload"
```
