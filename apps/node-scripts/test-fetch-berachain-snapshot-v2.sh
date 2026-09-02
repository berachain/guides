#!/usr/bin/env bash
set -euo pipefail

# Tests for fetch-berachain-snapshot-v2.sh
# Run: ./test-fetch-berachain-snapshot-v2.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/fetch-berachain-snapshot-v2.sh"
FIXTURE="file://$SCRIPT_DIR/test-fixtures/v2-catalog.csv"
FAILS=0

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; echo "    $2"; FAILS=$((FAILS + 1)); }

tmpdir() { mktemp -d "${TMPDIR:-/tmp}/snapv2-XXXXXX"; }

homes() {
  local tmp="$1"
  mkdir -p "$tmp/beacond/config" "$tmp/beacond/data" "$tmp/reth"
  printf operator-key >"$tmp/beacond/config/priv_validator_key.json"
  printf jwt-secret >"$tmp/beacond/config/jwt.hex"
}

reth_help_ok() {
  cat <<'EOF'
#!/bin/sh
if [ "$1" = "download" ] && [ "$2" = "--help" ]; then
  echo "Usage: bera-reth download"
  echo "      --manifest-url <URL>"
  echo "      --minimal"
  echo "      --archive"
  exit 0
fi
EOF
}

cl_payload() {
  cat <<'EOF'
#!/bin/sh
tmp=$(mktemp -d)
echo restored > "$tmp/blockstore.db"
tar -c -C "$tmp" .
rm -rf "$tmp"
EOF
}

echo
echo "fetch-berachain-snapshot-v2.sh restore tests"
echo

if "$SCRIPT" --network bepolia --beacon-only --el-only --no-download >/dev/null 2>"$(tmpdir)/err"; then
  fail "beacon-only and el-only exclusive" "expected non-zero"
else
  pass "beacon-only and el-only exclusive"
fi

if "$SCRIPT" --network bepolia --type pruned --catalog-url "$FIXTURE" --no-download >"$(tmpdir)/out" 2>/dev/null; then
  :
fi
tmp="$(tmpdir)"
if "$SCRIPT" --network bepolia --type pruned --catalog-url "$FIXTURE" --no-download >"$tmp/out" 2>"$tmp/err"; then
  if grep -q -- '--minimal' "$tmp/out" && grep -q manifest.json "$tmp/out" && grep -q 'beacon-kit-pruned-22980000' "$tmp/out" && ! grep -q beacon-kit-archive "$tmp/out"; then
    pass "--type pruned selects --minimal and cl-pruned"
  else
    fail "--type pruned selects --minimal and cl-pruned" "$(cat "$tmp/out")"
  fi
else
  fail "--type pruned selects --minimal and cl-pruned" "$(cat "$tmp/err")"
fi

tmp="$(tmpdir)"
if "$SCRIPT" --network bepolia --type archive --catalog-url "$FIXTURE" --no-download >"$tmp/out" 2>"$tmp/err"; then
  if grep -q -- '--archive' "$tmp/out" && grep -q 'beacon-kit-pruned-22980000' "$tmp/out"; then
    pass "--type archive selects --archive and cl-pruned"
  else
    fail "--type archive selects --archive and cl-pruned" "$(cat "$tmp/out")"
  fi
else
  fail "--type archive selects --archive and cl-pruned" "$(cat "$tmp/err")"
fi

tmp="$(tmpdir)"
if "$SCRIPT" --network bepolia --type pruned --full-cl --catalog-url "$FIXTURE" --no-download >"$tmp/out" 2>"$tmp/err"; then
  if grep -q 'beacon-kit-archive-22980000' "$tmp/out" && ! grep -q beacon-kit-pruned "$tmp/out"; then
    pass "--full-cl selects cl-archive"
  else
    fail "--full-cl selects cl-archive" "$(cat "$tmp/out")"
  fi
else
  fail "--full-cl selects cl-archive" "$(cat "$tmp/err")"
fi

tmp="$(tmpdir)"
if "$SCRIPT" --network bepolia --catalog-url "file://$tmp/missing.csv" --no-download >/dev/null 2>"$tmp/err"; then
  fail "missing catalog generic error" "expected non-zero"
else
  if grep -qiE 'catalog|No such file|ENOENT' "$tmp/err" && ! grep -q fetch-berachain-snapshot.js "$tmp/err"; then
    pass "missing catalog generic error"
  else
    fail "missing catalog generic error" "$(cat "$tmp/err")"
  fi
fi

tmp="$(tmpdir)"
if "$SCRIPT" --network mainnet --catalog-url "file://$tmp/missing.csv" --no-download >/dev/null 2>"$tmp/err"; then
  fail "mainnet missing catalog is generic" "expected non-zero"
else
  if ! grep -q fetch-berachain-snapshot.js "$tmp/err" && ! grep -q index.csv "$tmp/err"; then
    pass "mainnet missing catalog is generic, not a v1 fallback"
  else
    fail "mainnet missing catalog is generic, not a v1 fallback" "$(cat "$tmp/err")"
  fi
fi

tmp="$(tmpdir)"
cat >"$tmp/catalog.csv" <<'EOF'
type,layer,profile,block_number,size_bytes,created_at,object_key,download_url,role
reth,el,,1,1,2026-01-01T00:00:00Z,v2/bepolia/reth/manifest.json,https://example.test/manifest.json,el-manifest
EOF
if "$SCRIPT" --network bepolia --catalog-url "file://$tmp/catalog.csv" --no-download >/dev/null 2>"$tmp/err"; then
  fail "missing cl-pruned role fails" "expected non-zero"
else
  if grep -qi 'cl-pruned\|role' "$tmp/err"; then pass "missing cl-pruned role fails"; else fail "missing cl-pruned role fails" "$(cat "$tmp/err")"; fi
fi

tmp="$(tmpdir)"
if "$SCRIPT" --network bepolia --beacon-only --catalog-url "$FIXTURE" >/dev/null 2>"$tmp/err"; then
  fail "extract without BEACOND_DATA fails" "expected non-zero"
else
  if grep -q BEACOND_DATA "$tmp/err"; then pass "extract without BEACOND_DATA fails"; else fail "extract without BEACOND_DATA fails" "$(cat "$tmp/err")"; fi
fi

tmp="$(tmpdir)"; homes "$tmp"
printf x >"$tmp/reth/unexpected.bin"
bin="$tmp/bin"; mkdir -p "$bin"
reth_help_ok >"$bin/bera-reth"; echo 'exit 0' >>"$bin/bera-reth"; chmod +x "$bin/bera-reth"
cl_payload >"$bin/curl"; chmod +x "$bin/curl"
echo '#!/bin/sh
if [ "$1" = "-d" ]; then cat; else exit 1; fi' >"$bin/lz4"; chmod +x "$bin/lz4"
if PATH="$bin:$PATH" "$SCRIPT" --network bepolia --catalog-url "$FIXTURE" --reth-bin "$bin/bera-reth" \
  --beacond-data "$tmp/beacond" --reth-data "$tmp/reth" >/dev/null 2>"$tmp/err"; then
  fail "dirty reth without --force fails" "expected non-zero"
else
  if grep -qi unexpected "$tmp/err"; then pass "dirty reth without --force fails"; else fail "dirty reth without --force fails" "$(cat "$tmp/err")"; fi
fi

tmp="$(tmpdir)"; homes "$tmp"
mkdir -p "$tmp/reth/db" "$tmp/reth/static_files"
printf init >"$tmp/reth/db/mdbx.dat"
bin="$tmp/bin"; mkdir -p "$bin"
{
  reth_help_ok
  echo "echo \"\$@\" >> \"$tmp/reth.log\""
  echo "echo el > \"$tmp/reth/restored.txt\""
  echo "exit 0"
} >"$bin/bera-reth"; chmod +x "$bin/bera-reth"
cl_payload >"$bin/curl"; chmod +x "$bin/curl"
echo '#!/bin/sh
if [ "$1" = "-d" ]; then cat; else exit 1; fi' >"$bin/lz4"; chmod +x "$bin/lz4"
if PATH="$bin:$PATH" "$SCRIPT" --network bepolia --catalog-url "$FIXTURE" --reth-bin "$bin/bera-reth" \
  --beacond-data "$tmp/beacond" --reth-data "$tmp/reth" >"$tmp/out" 2>"$tmp/err"; then
  if [[ ! -f "$tmp/reth/db/mdbx.dat" && "$(cat "$tmp/reth/restored.txt")" == el ]]; then
    pass "setup-reth init datadir replaced without --force"
  else
    fail "setup-reth init datadir replaced without --force" "$(ls -R "$tmp/reth")"
  fi
else
  fail "setup-reth init datadir replaced without --force" "$(cat "$tmp/err")"
fi

tmp="$(tmpdir)"
echo '#!/bin/sh
echo "$@" >> /tmp/should-not-curl
exit 99' >"$tmp/curl"; chmod +x "$tmp/curl"
if PATH="$tmp:$PATH" "$SCRIPT" --network bepolia --catalog-url "$FIXTURE" --no-download >"$tmp/out" 2>"$tmp/err"; then
  if grep -q 'bera-reth download' "$tmp/out" && grep -q 'lz4 -d' "$tmp/out"; then
    pass "--no-download prints commands and skips curl"
  else
    fail "--no-download prints commands and skips curl" "$(cat "$tmp/out")"
  fi
else
  fail "--no-download prints commands and skips curl" "$(cat "$tmp/err")"
fi

tmp="$(tmpdir)"; homes "$tmp"
bin="$tmp/bin"; mkdir -p "$bin"
cl_payload >"$bin/curl"; chmod +x "$bin/curl"
echo '#!/bin/sh
if [ "$1" = "-d" ]; then cat; else exit 1; fi' >"$bin/lz4"; chmod +x "$bin/lz4"
if PATH="$bin:$PATH" "$SCRIPT" --network bepolia --catalog-url "$FIXTURE" \
  --beacond-data "$tmp/beacond" --reth-data "$tmp/reth" >/dev/null 2>"$tmp/err"; then
  fail "missing bera-reth fails closed" "expected non-zero"
else
  if grep -qi 'bera-reth not found' "$tmp/err"; then pass "missing bera-reth fails closed"; else fail "missing bera-reth fails closed" "$(cat "$tmp/err")"; fi
fi

tmp="$(tmpdir)"; homes "$tmp"
bin="$tmp/bin"; mkdir -p "$bin"
cat >"$bin/bera-reth" <<'EOF'
#!/bin/sh
if [ "$1" = "download" ] && [ "$2" = "--help" ]; then
  echo "Usage: bera-reth download"
  echo "  -u, --url <URL>"
  exit 0
fi
exit 0
EOF
chmod +x "$bin/bera-reth"
if PATH="$bin:$PATH" "$SCRIPT" --network bepolia --catalog-url "$FIXTURE" --reth-bin "$bin/bera-reth" \
  --beacond-data "$tmp/beacond" --reth-data "$tmp/reth" >/dev/null 2>"$tmp/err"; then
  fail "reth without --manifest-url fails closed" "expected non-zero"
else
  if grep -q -- '--manifest-url' "$tmp/err"; then pass "reth without --manifest-url fails closed"; else fail "reth without --manifest-url fails closed" "$(cat "$tmp/err")"; fi
fi

tmp="$(tmpdir)"; homes "$tmp"
bin="$tmp/bin"; mkdir -p "$bin"
{
  reth_help_ok
  echo "echo \"\$@\" >> \"$tmp/reth.log\""
  echo "echo el > \"$tmp/reth/restored.txt\""
  echo "exit 0"
} >"$bin/bera-reth"; chmod +x "$bin/bera-reth"
cl_payload >"$bin/curl"; chmod +x "$bin/curl"
echo '#!/bin/sh
if [ "$1" = "-d" ]; then cat; else exit 1; fi' >"$bin/lz4"; chmod +x "$bin/lz4"
if PATH="$bin:$PATH" "$SCRIPT" --network bepolia --catalog-url "$FIXTURE" --reth-bin "$bin/bera-reth" \
  --beacond-data "$tmp/beacond" --reth-data "$tmp/reth" >"$tmp/out" 2>"$tmp/err"; then
  argv="$(cat "$tmp/reth.log")"
  if echo "$argv" | grep -q -- '--manifest-url' && echo "$argv" | grep -q -- '--minimal' \
    && echo "$argv" | grep -q -- "--datadir $tmp/reth" \
    && [[ "$(cat "$tmp/beacond/data/blockstore.db")" == restored ]] \
    && [[ "$(cat "$tmp/beacond/config/priv_validator_key.json")" == operator-key ]]; then
    pass "CL extract lands in BEACOND_DATA/data; EL gets --manifest-url --minimal"
  else
    fail "CL extract lands in BEACOND_DATA/data; EL gets --manifest-url --minimal" "$argv"
  fi
else
  fail "CL extract lands in BEACOND_DATA/data; EL gets --manifest-url --minimal" "$(cat "$tmp/err")"
fi

tmp="$(tmpdir)"
if CHAIN=bepolia "$SCRIPT" --catalog-url "$FIXTURE" --no-download >"$tmp/out" 2>"$tmp/err"; then
  if grep -q -- '--chain bepolia' "$tmp/out"; then pass "CHAIN sets default network"; else fail "CHAIN sets default network" "$(cat "$tmp/out")"; fi
else
  fail "CHAIN sets default network" "$(cat "$tmp/err")"
fi

tmp="$(tmpdir)"
if CHAIN=mainnet "$SCRIPT" --network bepolia --catalog-url "$FIXTURE" --no-download >"$tmp/out" 2>"$tmp/err"; then
  if grep -q -- '--chain bepolia' "$tmp/out"; then pass "--network overrides CHAIN"; else fail "--network overrides CHAIN" "$(cat "$tmp/out")"; fi
else
  fail "--network overrides CHAIN" "$(cat "$tmp/err")"
fi

tmp="$(tmpdir)"
if CHAIN=sepolia "$SCRIPT" --catalog-url "$FIXTURE" --no-download >"$tmp/out" 2>"$tmp/err"; then
  if grep -q 'Network: mainnet' "$tmp/out" && grep -q -- '--chain mainnet' "$tmp/out"; then
    pass "invalid CHAIN falls back to mainnet catalog shape"
  else
    fail "invalid CHAIN falls back to mainnet catalog shape" "$(cat "$tmp/out")"
  fi
else
  fail "invalid CHAIN falls back to mainnet catalog shape" "$(cat "$tmp/err")"
fi

tmp="$(tmpdir)"
if "$SCRIPT" --network mainnet --help >"$tmp/out" 2>"$tmp/err"; then
  if grep -q 'v2/mainnet/catalog.csv' "$tmp/out" && grep -q 'v2/bepolia/catalog.csv' "$tmp/out"; then
    pass "mainnet uses the same catalog URL shape as bepolia"
  else
    fail "mainnet uses the same catalog URL shape as bepolia" "$(cat "$tmp/out")"
  fi
else
  fail "mainnet uses the same catalog URL shape as bepolia" "$(cat "$tmp/err")"
fi

echo
if [[ "$FAILS" -eq 0 ]]; then
  echo "All tests passed."
  echo
  exit 0
fi
echo "$FAILS test(s) failed."
exit 1
