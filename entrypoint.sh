#!/usr/bin/env bash
set -e

if [ -f /data/params ]; then
    set -a
    # shellcheck disable=SC1091
    source /data/params
    set +a
fi

BASE_URL="http://frontend-url"
CONCURRENCY=5
DURATION=60s
PORT=4999


if ! [[ "${CONCURRENCY}" =~ ^[0-9]+$ ]] || [ "${CONCURRENCY}" -lt 1 ]; then
    echo "CONCURRENCY must be a positive integer" >&2
    exit 1
fi

if ! [[ "${DURATION}" =~ ^[0-9]+$ ]] || [ "${DURATION}" -lt 1 ]; then
    echo "DURATION must be a positive integer (seconds)" >&2
    exit 1
fi

if ! [[ "${PORT}" =~ ^[0-9]+$ ]] || [ "${PORT}" -lt 1 ]; then
    echo "PORT must be a positive integer" >&2
    exit 1
fi

export BASE_URL
export CONCURRENCY
export DURATION
export PORT
export BUILD_ID="${BUILD_ID:-local}"
export AUTO_RUN="${AUTO_RUN:-false}"

export BASE_URL="$(
python3 - <<'PY'
import os
import sys
from urllib.parse import urlparse

raw = os.environ["BASE_URL"].strip()
if not raw:
    print("BASE_URL is empty", file=sys.stderr)
    sys.exit(1)

if "://" not in raw:
    raw = f"http://{raw}"

parsed = urlparse(raw)
if not parsed.scheme or not parsed.netloc:
    print(f"Invalid BASE_URL: {os.environ['BASE_URL']}", file=sys.stderr)
    sys.exit(1)

if parsed.scheme not in ("http", "https"):
    print("BASE_URL must use http or https", file=sys.stderr)
    sys.exit(1)

print(f"{parsed.scheme}://{parsed.netloc}".rstrip("/"))
PY
)"

echo "Load tester configuration:"
echo "  BASE_URL=${BASE_URL}"
echo "  CONCURRENCY=${CONCURRENCY}"
echo "  DURATION=${DURATION}"
echo "  PORT=${PORT}"
echo "  BUILD_ID=${BUILD_ID}"
echo "  AUTO_RUN=${AUTO_RUN}"

exec python3 app.py
