#!/usr/bin/env bash
# TP-7: guides experimental v2 mode → URL/flag resolution smoke.
set -eu
if (set -o pipefail) 2>/dev/null; then :; fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="$ROOT/v2-snapshot-pairing.sh"
FIXTURE="$(mktemp)"
trap 'rm -f "$FIXTURE"' EXIT

cat > "$FIXTURE" <<'EOF'
type,layer,profile,block_number,size_bytes,created_at,object_key,download_url,role
reth,el,,100,10,2026-07-22T12:00:00Z,v2/bepolia/reth/manifest.json,https://bera-snapshots.fsn1.your-objectstorage.com/v2/bepolia/reth/manifest.json,el-manifest
beacon-kit,cl,pruned,100,20,2026-07-22T12:00:00Z,v2/bepolia/beacon-kit/pruned/beacon-kit-pruned-100.tar.lz4,https://bera-snapshots.fsn1.your-objectstorage.com/v2/bepolia/beacon-kit/pruned/beacon-kit-pruned-100.tar.lz4,cl-pruned
beacon-kit,cl,archive,100,40,2026-07-22T12:00:00Z,v2/bepolia/beacon-kit/archive/beacon-kit-archive-100.tar.lz4,https://bera-snapshots.fsn1.your-objectstorage.com/v2/bepolia/beacon-kit/archive/beacon-kit-archive-100.tar.lz4,cl-archive
EOF

pruned_out="$("$HELPER" resolve "$FIXTURE" pruned)"
archive_out="$("$HELPER" resolve "$FIXTURE" archive)"
full_out="$("$HELPER" resolve "$FIXTURE" full_archive)"

echo "$pruned_out" | grep -q 'EL_PRESET=--minimal'
echo "$pruned_out" | grep -q 'CL_ROLE=cl-pruned'
echo "$archive_out" | grep -q 'EL_PRESET=--archive'
echo "$archive_out" | grep -q 'CL_ROLE=cl-pruned'
echo "$full_out" | grep -q 'EL_PRESET=--archive'
echo "$full_out" | grep -q 'CL_ROLE=cl-archive'
echo "$full_out" | grep -q 'beacon-kit/archive'

archive_cl="$(printf '%s\n' "$archive_out" | sed -n 's/^CL_URL=//p')"
full_cl="$(printf '%s\n' "$full_out" | sed -n 's/^CL_URL=//p')"
[[ "$archive_cl" != "$full_cl" ]]

echo "$pruned_out" | grep -q 'DOWNLOAD_CMD=bera-reth download'
echo "$archive_out" | grep -q '--manifest-url'

echo "test-v2-snapshot-pairing: PASS"
