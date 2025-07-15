#!/bin/bash

BRANCH="master"
DEPLOY_SCRIPT="./deploy.sh"

git fetch origin "$BRANCH"

LOCAL_HASH=$(git rev-parse "$BRANCH")
REMOTE_HASH=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL_HASH" != "$REMOTE_HASH" ]; then
    MESSAGE="$(date '+%Y-%m-%d %H:%M:%S') — New changes in origin/$BRANCH, deploying from commit $REMOTE_HASH"
    echo "$MESSAGE"
    git reset --hard "origin/$BRANCH"
    bash "$DEPLOY_SCRIPT"

    # Send Telegram notification if configured
    if [[ -n "$TG_BOT_TOKEN" && -n "$TG_CHAT_ID" ]]; then
        curl -s -X POST "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
            -d "chat_id=${TG_CHAT_ID}" \
            -d "text=${MESSAGE}" \
            -d "parse_mode=Markdown"
    fi
fi
