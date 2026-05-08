#!/bin/bash

BRANCH="master"
DEPLOY_SCRIPT="./deploy.sh"
DEPLOY_ARGS=()

print_help() {
    echo "$0 checks a branch for updates and runs deploy when it changes"
    echo -e "\tdefault:\ttrack master and run production deploy"
    echo -e "\t--rc:\ttrack rc and run RC deploy"
    echo -e "\t--help:\tprints this text and exits"
}

while [ "$1" != "" ]; do
    case $1 in
        "--rc")
            BRANCH="rc"
            DEPLOY_ARGS=(--rc)
            ;;
        "--help") print_help; exit 0;;
        *)
            echo "error: unknown option $1"
            print_help
            exit 1
            ;;
    esac
    shift
done

git -c safe.directory=$(pwd) remote set-url origin https://${GITHUB_TOKEN}@github.com/gibsn/technochat.git

git -c safe.directory=$(pwd) fetch origin "+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}"

if git -c safe.directory=$(pwd) show-ref --verify --quiet "refs/heads/$BRANCH"; then
    LOCAL_HASH=$(git -c safe.directory=$(pwd) rev-parse "$BRANCH")
else
    LOCAL_HASH=""
fi
REMOTE_HASH=$(git -c safe.directory=$(pwd) rev-parse "origin/$BRANCH")

if [ "$LOCAL_HASH" != "$REMOTE_HASH" ]; then
    git -c safe.directory=$(pwd) checkout -B "$BRANCH" "origin/$BRANCH"
    git -c safe.directory=$(pwd) reset --hard "origin/$BRANCH"
    chmod +x ./dist/autodeploy.sh

    COMMIT_MSG=$(git -c safe.directory=$(pwd) log -1 --pretty=%s "$REMOTE_HASH")

    if bash "$DEPLOY_SCRIPT" "${DEPLOY_ARGS[@]}"; then
        STATUS="✅ Deploy successful"
    else
        STATUS="❌ Deploy failed"
    fi

    MESSAGE="$(date '+%Y-%m-%d %H:%M:%S') — $STATUS. Commit: '$REMOTE_HASH', Message: '$COMMIT_MSG'"

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
