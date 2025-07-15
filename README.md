# Technochat

## Set up automatic deploy
Call `make setup_autodeploy`

Define TG_BOT_TOKEN and TG_CHAT_ID in /etc/default/autodeploy_technochat:
```
TG_BOT_TOKEN=123456:ABCDEF...
TG_CHAT_ID=-1001234567890
```

Move the contents of this repo to /opt/technochat:
```
mkdir /opt/technochat
cp ./* /opt/technochat
```

Copy autodeploy.sh and initialise systemd-service:
```
sudo cp autodeploy.sh /opt/technochat/
sudo chmod +x /opt/technochat/autodeploy.sh

sudo cp ./dist/autodeploy_technochat.service /etc/systemd/system/
sudo cp ./dist/autodeploy_technochat.timer /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now autodeploy_technochat.timer
```

Define TG_BOT_TOKEN and TG_CHAT_ID in /etc/default/autodeploy_technochat:
```
TG_BOT_TOKEN=123456:ABCDEF...
TG_CHAT_ID=-1001234567890
```
