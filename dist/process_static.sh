#!/bin/bash

set -euo pipefail
export LC_ALL=C

static_root=${STATIC_ROOT:-/static}
magic=${STATIC_MAGIC:-$(od -An -tx4 -N4 /dev/urandom | tr -d ' \n')}

sed_in_place() {
    if sed --version >/dev/null 2>&1; then
        sed -i "$@"
    else
        sed -i '' "$@"
    fi
}

sed_in_place "s,__STATIC_VERSION__,$magic,g" "$static_root/sw.js"

find "$static_root" -type f ! -path "$static_root/html/*" -exec basename '{}' \; | sort | uniq | \
while read -r static_file_name; do
    if [ "$static_file_name" = "sw.js" ]; then
        continue
    fi

    escaped_static_file_name=$(printf '%s' "$static_file_name" | sed 's/[.[\*^$]/\\&/g')
    find "$static_root" -type f -exec bash -c '
        expression=$1
        shift
        if sed --version >/dev/null 2>&1; then
            sed -i "$expression" "$@"
        else
            sed -i "" "$expression" "$@"
        fi
    ' _ "s,/$escaped_static_file_name,/$static_file_name\?magic=$magic,g" '{}' +
done
