#!/usr/bin/env bash
# The ingester reuses four files that live in the Snippets worker (single source of truth = worker/src). Run from a Snippets checkout.
set -euo pipefail
cd "$(dirname "$0")"
for f in cluster.js guard.js resolver.js blocklist-core.js; do cp ../worker/src/$f vendor/$f; done
echo "vendor/ synced from ../worker/src"
