#!/bin/bash

magic=$(od -An -td -N2 /dev/urandom | tr -d ' ')
find /static -type f ! -name "html/*" | xargs -I{} basename {} | sort | uniq | \
while read static_file_name; do
    find /static -type f -exec sed -i "s,/$static_file_name,/$static_file_name\?magic=$magic,g" '{}' +
done
