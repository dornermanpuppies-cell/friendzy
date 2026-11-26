#!/usr/bin/env bash
# Vendors jsr:@negrel/webpush (MIT) + its @std/encoding dependency into one plain ES module, so the
# push-dispatch Edge Function has no `jsr:` import. Supabase deploys made through the Management API
# cannot resolve `jsr:` specifiers at boot (push-dispatch v15 failed with BOOT_ERROR until vendored).
# Usage: bash scripts/vendor-webpush.sh   (requires Deno 2.4+)
set -euo pipefail
VERSION="${WEBPUSH_VERSION:-0.5.0}"
OUT="supabase/functions/_shared/webpush.vendored.js"
TMP="$(mktemp -d)"
printf "export * from 'jsr:@negrel/webpush@%s';\n" "$VERSION" > "$TMP/entry.ts"
deno bundle --platform=deno --format=esm -o "$TMP/bundle.js" "$TMP/entry.ts" >/dev/null
{
  echo "// Vendored copy of jsr:@negrel/webpush@$VERSION (MIT License, Copyright (c) 2024 Alexandre Negrel)"
  echo "// plus its @std/encoding dependency, produced by scripts/vendor-webpush.sh with \`deno bundle\`."
  echo "// Generated file — do not edit by hand. Regenerate with: npm run functions:vendor-webpush"
  echo "// deno-lint-ignore-file"
  cat "$TMP/bundle.js"
} > "$OUT"
rm -rf "$TMP"
echo "wrote $OUT ($(wc -c < "$OUT") bytes)"
