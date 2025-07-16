# Technochat

## Set up automatic deploy
Define GITHUB_TOKEN, TG_BOT_TOKEN and TG_CHAT_ID in /etc/default/autodeploy_technochat:
```
GITHUB_TOKEN=github_pat...
TG_BOT_TOKEN=123456:ABCDEF...
TG_CHAT_ID=-1001234567890
```

Call `make setup_autodeploy`
