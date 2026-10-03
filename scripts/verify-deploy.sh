#!/usr/bin/env bash
set -u

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s BASE_URL\n' "$0" >&2
  exit 2
fi

base_url=${1%/}
response_file=$(mktemp)
trap 'rm -f "$response_file"' EXIT
failures=0

request() {
  status=$(curl --compressed --location --connect-timeout 3 --max-time 30 \
    --silent --show-error -o "$response_file" -w '%{http_code}' \
    "$base_url$1" 2>/dev/null) || status=000
}

check_2xx() {
  local label=$1
  local path=$2
  request "$path"
  if [[ "$status" =~ ^2[0-9][0-9]$ ]]; then
    printf 'PASS %-24s %s\n' "$label" "$status"
  else
    printf 'FAIL %-24s %s\n' "$label" "$status"
    failures=$((failures + 1))
  fi
}

check_2xx 'home' '/'
check_2xx 'admin' '/admin/'
check_2xx 'thalacXail' '/thalacXail'

request '/api/products'
if [[ "$status" =~ ^2[0-9][0-9]$ ]]; then
  product_count=$(node -e '
    const data = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    const count = Array.isArray(data)
      ? data.reduce((sum, group) => sum + (Array.isArray(group.items) ? group.items.length : 0), 0)
      : Array.isArray(data.products) ? data.products.length
      : Array.isArray(data.data) ? data.data.length
      : null;
    if (count === null) process.exit(1);
    process.stdout.write(String(count));
  ' < "$response_file" 2>/dev/null) || product_count=invalid-json
  if [[ "$product_count" != invalid-json ]]; then
    printf 'PASS %-24s %s products=%s\n' 'products' "$status" "$product_count"
  else
    printf 'FAIL %-24s %s invalid-json\n' 'products' "$status"
    failures=$((failures + 1))
  fi
else
  printf 'FAIL %-24s %s\n' 'products' "$status"
  failures=$((failures + 1))
fi

check_2xx 'categories' '/api/categories'

request '/api/customer/auth/me'
if [[ "$status" == 200 || "$status" == 401 ]]; then
  printf 'PASS %-24s %s\n' 'customer-auth-me' "$status"
else
  printf 'FAIL %-24s %s\n' 'customer-auth-me' "$status"
  failures=$((failures + 1))
fi

request '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=salah&hub.challenge=1'
if [[ "$status" == 403 ]]; then
  printf 'PASS %-24s %s (invalid token rejected)\n' 'whatsapp-webhook' "$status"
else
  printf 'FAIL %-24s %s (expected 403)\n' 'whatsapp-webhook' "$status"
  failures=$((failures + 1))
fi

if (( failures > 0 )); then
  exit 1
fi