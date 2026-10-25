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

check_contains() {
  local label=$1
  local path=$2
  local needle=$3
  request "$path"
  if [[ "$status" =~ ^2[0-9][0-9]$ ]] && grep -qF -- "$needle" "$response_file"; then
    printf 'PASS %-24s %s\n' "$label" "$status"
  else
    printf 'FAIL %-24s %s (missing: %s)\n' "$label" "$status" "$needle"
    failures=$((failures + 1))
  fi
}

check_absent() {
  local label=$1
  local path=$2
  local needle=$3
  request "$path"
  if [[ "$status" =~ ^2[0-9][0-9]$ ]] && ! grep -qF -- "$needle" "$response_file"; then
    printf 'PASS %-24s %s\n' "$label" "$status"
  else
    printf 'FAIL %-24s %s (found or unreachable: %s)\n' "$label" "$status" "$needle"
    failures=$((failures + 1))
  fi
}

check_2xx 'home' '/'
check_2xx 'admin' '/admin/'
check_2xx 'thalacXail' '/thalacXail'
check_2xx 'catalog-page' '/catalog.html'
check_2xx 'private-label' '/private-label.html'
check_2xx 'procurement' '/procurement.html'
check_2xx 'compliance' '/compliance.html'
check_2xx 'about' '/about.html'
check_2xx 'contact' '/contact.html'

# Domus skin and widget islands are served and wired into the pages.
check_2xx 'domus-css' '/styles/ail-domus.css'
check_2xx 'islands-js' '/islands/ail-islands.js'
check_2xx 'motion-js' '/vendor/motion-11.18.2.min.js'
check_2xx 'react-js' '/vendor/react.production.min.js'
check_2xx 'react-dom-js' '/vendor/react-dom.production.min.js'
check_contains 'home-domus' '/' 'id="ail-domus"'
check_contains 'home-gauge' '/' 'data-island="temp-gauge"'
check_contains 'procurement-stepper' '/procurement.html' 'data-island="stepper"'
check_contains 'contact-hours' '/contact.html' 'data-island="hours"'

# The postcode stays off every public page.
for page in / /catalog.html /private-label.html /procurement.html /compliance.html /about.html /contact.html; do
  check_absent "no-postcode ${page}" "$page" '70582'
done

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