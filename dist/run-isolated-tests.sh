#!/bin/bash

set -euo pipefail

if [ "${1:-}" = "--" ]; then
    shift
fi

port_is_free() {
    local port="$1"

    ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

find_free_port() {
    local start="$1"
    local port="$start"

    while ! port_is_free "$port"; do
        port=$((port + 1))
    done

    echo "$port"
}

safe_user="$(printf '%s' "${USER:-user}" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]_-')"
safe_name="$(basename "$(pwd)" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]_-')"
port_offset=$(( $$ % 1000 ))
if [ -z "$safe_name" ]; then
    safe_name="worktree"
fi
if [ -z "$safe_user" ]; then
    safe_user="user"
fi

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-technochat_tests_${safe_user}_${safe_name}_$$}"
export TECHNOCHAT_HTTP_PORT="${TECHNOCHAT_HTTP_PORT:-$(find_free_port $((18080 + port_offset)))}"
export TECHNOCHAT_HTTPS_PORT="${TECHNOCHAT_HTTPS_PORT:-$(find_free_port $((18443 + port_offset)))}"

cleanup() {
    ./deploy.sh --tests --down >/dev/null 2>&1 || true
}
trap cleanup EXIT

./deploy.sh --tests

for i in {1..20}; do
    if curl -kfs "https://127.0.0.1:${TECHNOCHAT_HTTPS_PORT}/" >/dev/null; then
        break
    fi

    if [ "$i" = 20 ]; then
        echo "error: isolated HTTPS server did not start on port ${TECHNOCHAT_HTTPS_PORT}" >&2
        docker compose -f dist/docker-compose.yml -f dist/docker-compose-tests.yml ps >&2 || true
        docker compose -f dist/docker-compose.yml -f dist/docker-compose-tests.yml logs --no-color >&2 || true
        exit 1
    fi

    sleep 1
done

export UI_TEST_BASE_URL="https://127.0.0.1:${TECHNOCHAT_HTTPS_PORT}"
export TECHNOCHAT_TEST_API_URL="$UI_TEST_BASE_URL"

set +e
if [ "$#" = 0 ]; then
    make go-tests
    status=$?

    if [ "$status" = 0 ]; then
        make integration-tests-run
        status=$?
    fi

    if [ "$status" = 0 ]; then
        make ui-unit-tests
        status=$?
    fi

    if [ "$status" = 0 ]; then
        make ui-e2e-tests-run
        status=$?
    fi
else
    "$@"
    status=$?
fi
set -e

if [ "$status" != 0 ]; then
    docker compose -f dist/docker-compose.yml -f dist/docker-compose-tests.yml ps >&2 || true
    docker compose -f dist/docker-compose.yml -f dist/docker-compose-tests.yml logs --no-color >&2 || true
fi

exit "$status"
