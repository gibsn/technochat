#!/bin/bash

BRANCH="master"
DEPLOY_SCRIPT="./deploy.sh"

git -c safe.directory=$(pwd) remote set-url origin https://${GITHUB_TOKEN}@github.com/gibsn/technochat.git
git -c safe.directory=$(pwd) fetch origin "$BRANCH"

LOCAL_HASH=$(git -c safe.directory=$(pwd) rev-parse "$BRANCH")
REMOTE_HASH=$(git -c safe.directory=$(pwd) rev-parse "origin/$BRANCH")

if [ "$LOCAL_HASH" != "$REMOTE_HASH" ]; then
    git -c safe.directory=$(pwd) reset --hard "origin/$BRANCH"

    COMMIT_MSG=$(git -c safe.directory=$(pwd) log -1 --pretty=%s "$REMOTE_HASH")

    if bash "$DEPLOY_SCRIPT"; then
        STATUS="✅ Deploy successful"
    else
        STATUS="❌ Deploy failed"
    fi

    MESSAGE="$(date '+%Y-%m-%d %H:%M:%S') — $STATUS Commit: '$REMOTE_HASH', Message: '$COMMIT_MSG'"

    if [[ "$STATUS" == "✅ Deploy successful" ]]; then
        echo -e "$MESSAGE"
    else
        echo -e "$MESSAGE" >&2
    fi

    # Send Telegram notification if configured
    if [[ -n "$TG_BOT_TOKEN" && -n "$TG_CHAT_ID" ]]; then
        curl -s -X POST "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
            -d "chat_id=${TG_CHAT_ID}" \
            -d "text=${MESSAGE}" \
            -d "parse_mode=Markdown"
    fi
fi
