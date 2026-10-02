#!/usr/bin/env bash
# Bridge - checks: build + logic + relay + site in a fake browser
set -e
cd "$(dirname "$0")"
node tools/check-all.mjs
