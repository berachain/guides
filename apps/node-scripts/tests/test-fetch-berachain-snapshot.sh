#!/usr/bin/env bash
set -euo pipefail

# Tests for fetch-berachain-snapshot.sh
# Run: ./tests/test-fetch-berachain-snapshot.sh

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$TEST_DIR/.." && pwd)"
SCRIPT="$ROOT/fetch-berachain-snapshot.sh"
FAILS=0

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; echo "    $2"; FAILS=$((FAILS + 1)); }

tmpdir() { mktemp -d "${TMPDIR:-/tmp}/snapv1-XXXXXX"; }

write_index() {
  local dir="$1"
  local base="${2:-https://example.test}"
  cat >"$dir/index.csv" <<EOF
type,url,url_s3,created_at
beacon-kit-pruned,${base}/beacon-kit-pruned-100.tar.lz4,,2026-01-02T00:00:00Z
reth-pruned,${base}/reth-pruned-100.tar.lz4,,2026-01-02T00:00:00Z
beacon-kit-archive,${base}/beacon-kit-archive-100.tar.lz4,,2026-01-02T00:00:00Z
reth-archive,${base}/reth-archive-100.tar.lz4,,2026-01-02T00:00:00Z
EOF
}

make_lz4_tar() {
  local dest="$1"
  local staging
  staging="$(mktemp -d)"
  shift
  while [[ $# -gt 0 ]]; do
    local rel="$1" contents="$2"
    mkdir -p "$staging/$(dirname "$rel")"
    printf '%s' "$contents" >"$staging/$rel"
    shift 2
  done
  tar -c -C "$staging" . | lz4 -c >"$dest"
  rm -rf "$staging"
}

curl_copy_stub() {
  local fixture="$1"
  cat <<EOF
#!/bin/sh
out=""; url=""
while [ \$# -gt 0 ]; do
  case "\$1" in
    -o) out="\$2"; shift 2 ;;
    -C) shift 2 ;;
    -L|-s|-f|-S|-k) shift ;;
    -*) shift ;;
    *) url="\$1"; shift ;;
  esac
done
name=\$(basename "\$url")
name=\${name%%\?*}
src="$fixture/\$name"
[ -f "\$src" ] || { echo "missing fixture \$src" >&2; exit 1; }
if [ -n "\$out" ]; then
  mkdir -p "\$(dirname "\$out")"
  cp "\$src" "\$out"
else
  cat "\$src"
fi
EOF
}

echo
echo "fetch-berachain-snapshot.sh restore tests"
echo

# mutually exclusive
out="$(tmpdir)"
if "$SCRIPT" --beacon-only --el-only --no-extract >/dev/null 2>"$out/err"; then
  fail "beacon-only and el-only exclusive" "expected non-zero"
else
  if grep -qi 'beacon-only' "$out/err"; then pass "beacon-only and el-only exclusive"; else fail "beacon-only and el-only exclusive" "$(cat "$out/err")"; fi
fi

# pruned selects pruned
tmp="$(tmpdir)"
fix="$tmp/files"; mkdir -p "$fix" "$tmp/downloads"
printf x >"$fix/beacon-kit-pruned-100.tar.lz4"
printf x >"$fix/reth-pruned-100.tar.lz4"
write_index "$fix"
bin="$tmp/bin"; mkdir -p "$bin"
curl_copy_stub "$fix" >"$bin/curl"; chmod +x "$bin/curl"
if PATH="$bin:$PATH" "$SCRIPT" --type pruned --no-extract -o "$tmp/downloads" >"$tmp/out" 2>"$tmp/err"; then
  if grep -q 'beacon-kit-pruned-100' "$tmp/out" && grep -q 'reth-pruned-100' "$tmp/out" && ! grep -q 'archive-100' "$tmp/out"; then
    pass "--type pruned selects pruned rows"
  else
    fail "--type pruned selects pruned rows" "$(cat "$tmp/out")"
  fi
else
  fail "--type pruned selects pruned rows" "$(cat "$tmp/err")"
fi

# archive
tmp="$(tmpdir)"
fix="$tmp/files"; mkdir -p "$fix"
printf x >"$fix/beacon-kit-archive-100.tar.lz4"
printf x >"$fix/reth-archive-100.tar.lz4"
write_index "$fix"
bin="$tmp/bin"; mkdir -p "$bin"
curl_copy_stub "$fix" >"$bin/curl"; chmod +x "$bin/curl"
if PATH="$bin:$PATH" "$SCRIPT" --type archive --no-extract -o "$tmp/downloads" >"$tmp/out" 2>"$tmp/err"; then
  if grep -q 'beacon-kit-archive-100' "$tmp/out" && ! grep -q 'pruned-100' "$tmp/out"; then
    pass "--type archive selects archive rows"
  else
    fail "--type archive selects archive rows" "$(cat "$tmp/out")"
  fi
else
  fail "--type archive selects archive rows" "$(cat "$tmp/err")"
fi

# CHAIN default
tmp="$(tmpdir)"; fix="$tmp/files"; mkdir -p "$fix"
printf x >"$fix/beacon-kit-pruned-100.tar.lz4"
write_index "$fix"
bin="$tmp/bin"; mkdir -p "$bin"
curl_copy_stub "$fix" >"$bin/curl"; chmod +x "$bin/curl"
if PATH="$bin:$PATH" CHAIN=bepolia "$SCRIPT" --no-extract --beacon-only -o "$tmp/downloads" >"$tmp/out" 2>"$tmp/err"; then
  if grep -q 'Network: bepolia' "$tmp/out"; then pass "CHAIN sets default network"; else fail "CHAIN sets default network" "$(cat "$tmp/out")"; fi
else
  fail "CHAIN sets default network" "$(cat "$tmp/err")"
fi

# --network overrides CHAIN
tmp="$(tmpdir)"; fix="$tmp/files"; mkdir -p "$fix"
printf x >"$fix/beacon-kit-pruned-100.tar.lz4"
write_index "$fix"
bin="$tmp/bin"; mkdir -p "$bin"
curl_copy_stub "$fix" >"$bin/curl"; chmod +x "$bin/curl"
if PATH="$bin:$PATH" CHAIN=mainnet "$SCRIPT" --network bepolia --no-extract --beacon-only -o "$tmp/downloads" >"$tmp/out" 2>"$tmp/err"; then
  if grep -q 'Network: bepolia' "$tmp/out"; then pass "--network overrides CHAIN"; else fail "--network overrides CHAIN" "$(cat "$tmp/out")"; fi
else
  fail "--network overrides CHAIN" "$(cat "$tmp/err")"
fi

# env.sh CHAIN is used when CHAIN is unset (no --network)
tmp="$(tmpdir)"; fix="$tmp/files"; mkdir -p "$fix"
printf x >"$fix/beacon-kit-pruned-100.tar.lz4"
write_index "$fix"
bin="$tmp/bin"; mkdir -p "$bin"
curl_copy_stub "$fix" >"$bin/curl"; chmod +x "$bin/curl"
cp "$ROOT/fetch-berachain-snapshot.sh" "$ROOT/lib-snapshot.sh" "$tmp/"
printf 'export CHAIN=bepolia\n' >"$tmp/env.sh"
chmod +x "$tmp/fetch-berachain-snapshot.sh"
if PATH="$bin:$PATH" env -u CHAIN "$tmp/fetch-berachain-snapshot.sh" --no-extract --beacon-only -o "$tmp/downloads" >"$tmp/out" 2>"$tmp/err"; then
  if grep -q 'Network: bepolia' "$tmp/out" && grep -q 'bepolia.snapshots.berachain.com' "$tmp/out"; then
    pass "env.sh CHAIN selects network without exporting CHAIN"
  else
    fail "env.sh CHAIN selects network without exporting CHAIN" "$(cat "$tmp/out")"
  fi
else
  fail "env.sh CHAIN selects network without exporting CHAIN" "$(cat "$tmp/err")"
fi

# missing snapshot
tmp="$(tmpdir)"; fix="$tmp/files"; mkdir -p "$fix"
cat >"$fix/index.csv" <<'EOF'
type,url,url_s3,created_at
reth-pruned,https://example.test/nope.tar.lz4,,2026-01-02T00:00:00Z
EOF
bin="$tmp/bin"; mkdir -p "$bin"
curl_copy_stub "$fix" >"$bin/curl"; chmod +x "$bin/curl"
if PATH="$bin:$PATH" "$SCRIPT" --beacon-only --no-extract >/dev/null 2>"$tmp/err"; then
  fail "missing beacon snapshot fails" "expected non-zero"
else
  if grep -qi 'no snapshot' "$tmp/err"; then pass "missing beacon snapshot fails"; else fail "missing beacon snapshot fails" "$(cat "$tmp/err")"; fi
fi

# extract without BEACOND_DATA
tmp="$(tmpdir)"
cp "$ROOT/fetch-berachain-snapshot.sh" "$ROOT/lib-snapshot.sh" "$tmp/"
chmod +x "$tmp/fetch-berachain-snapshot.sh"
if (cd "$tmp" && unset BEACOND_DATA RETH_DATA CHAIN && ./fetch-berachain-snapshot.sh --beacon-only >/dev/null 2>"$tmp/err"); then
  fail "extract without BEACOND_DATA fails" "expected non-zero"
else
  if grep -q BEACOND_DATA "$tmp/err"; then pass "extract without BEACOND_DATA fails"; else fail "extract without BEACOND_DATA fails" "$(cat "$tmp/err")"; fi
fi

# dirty reth without --force
tmp="$(tmpdir)"; fix="$tmp/files"; mkdir -p "$fix" "$tmp/beacond/config" "$tmp/beacond/data" "$tmp/reth"
make_lz4_tar "$fix/beacon-kit-pruned-100.tar.lz4" blockstore.db/x blocks
make_lz4_tar "$fix/reth-pruned-100.tar.lz4" db/x data
write_index "$fix"
printf operator >"$tmp/beacond/config/priv_validator_key.json"
printf jwt >"$tmp/beacond/config/jwt.hex"
printf unexpected >"$tmp/reth/unexpected.bin"
bin="$tmp/bin"; mkdir -p "$bin"
curl_copy_stub "$fix" >"$bin/curl"; chmod +x "$bin/curl"
if PATH="$bin:$PATH" "$SCRIPT" --beacond-data "$tmp/beacond" --reth-data "$tmp/reth" -o "$tmp/downloads" >/dev/null 2>"$tmp/err"; then
  fail "dirty reth without --force fails" "expected non-zero"
else
  if grep -qi unexpected "$tmp/err"; then pass "dirty reth without --force fails"; else fail "dirty reth without --force fails" "$(cat "$tmp/err")"; fi
fi

# setup-reth init replaced without --force
tmp="$(tmpdir)"; fix="$tmp/files"; mkdir -p "$fix" "$tmp/beacond/config" "$tmp/beacond/data" "$tmp/reth/db" "$tmp/reth/static_files"
make_lz4_tar "$fix/beacon-kit-pruned-100.tar.lz4" blockstore.db/x blocks
make_lz4_tar "$fix/reth-pruned-100.tar.lz4" db/mdbx.dat restored
write_index "$fix"
printf operator >"$tmp/beacond/config/priv_validator_key.json"
printf jwt >"$tmp/beacond/config/jwt.hex"
printf init >"$tmp/reth/db/mdbx.dat"
bin="$tmp/bin"; mkdir -p "$bin"
curl_copy_stub "$fix" >"$bin/curl"; chmod +x "$bin/curl"
if PATH="$bin:$PATH" "$SCRIPT" --beacond-data "$tmp/beacond" --reth-data "$tmp/reth" -o "$tmp/downloads" >"$tmp/out" 2>"$tmp/err"; then
  if [[ "$(cat "$tmp/reth/db/mdbx.dat")" == restored ]]; then
    pass "setup-reth init datadir replaced without --force"
  else
    fail "setup-reth init datadir replaced without --force" "got $(cat "$tmp/reth/db/mdbx.dat")"
  fi
else
  fail "setup-reth init datadir replaced without --force" "$(cat "$tmp/err")"
fi

# flat CL extract preserves keys
tmp="$(tmpdir)"; fix="$tmp/files"; mkdir -p "$fix" "$tmp/beacond/config" "$tmp/beacond/data" "$tmp/reth"
make_lz4_tar "$fix/beacon-kit-pruned-100.tar.lz4" blockstore.db/block.db blocks
make_lz4_tar "$fix/reth-pruned-100.tar.lz4" db/x data
write_index "$fix"
printf operator-key >"$tmp/beacond/config/priv_validator_key.json"
printf jwt-secret >"$tmp/beacond/config/jwt.hex"
bin="$tmp/bin"; mkdir -p "$bin"
curl_copy_stub "$fix" >"$bin/curl"; chmod +x "$bin/curl"
if PATH="$bin:$PATH" "$SCRIPT" --beacond-data "$tmp/beacond" --reth-data "$tmp/reth" -o "$tmp/downloads" >"$tmp/out" 2>"$tmp/err"; then
  if [[ "$(cat "$tmp/beacond/config/priv_validator_key.json")" == operator-key ]] \
    && [[ "$(cat "$tmp/beacond/data/blockstore.db/block.db")" == blocks ]] \
    && [[ -f "$tmp/beacond/data/priv_validator_state.json" ]]; then
    pass "flat CL tarball extracts into data/ and preserves keys"
  else
    fail "flat CL tarball extracts into data/ and preserves keys" "$(ls -R "$tmp/beacond")"
  fi
else
  fail "flat CL tarball extracts into data/ and preserves keys" "$(cat "$tmp/err")"
fi

# keep priv_validator_state.json
tmp="$(tmpdir)"; fix="$tmp/files"; mkdir -p "$fix" "$tmp/beacond/config" "$tmp/beacond/data" "$tmp/reth"
make_lz4_tar "$fix/beacon-kit-pruned-100.tar.lz4" blockstore.db/x blocks
make_lz4_tar "$fix/reth-pruned-100.tar.lz4" db/x data
write_index "$fix"
printf operator >"$tmp/beacond/config/priv_validator_key.json"
printf jwt >"$tmp/beacond/config/jwt.hex"
printf '{"height":"0"}' >"$tmp/beacond/data/priv_validator_state.json"
bin="$tmp/bin"; mkdir -p "$bin"
curl_copy_stub "$fix" >"$bin/curl"; chmod +x "$bin/curl"
if PATH="$bin:$PATH" "$SCRIPT" --beacond-data "$tmp/beacond" --reth-data "$tmp/reth" -o "$tmp/downloads" >/dev/null 2>"$tmp/err"; then
  if [[ "$(cat "$tmp/beacond/data/priv_validator_state.json")" == '{"height":"0"}' ]]; then
    pass "existing priv_validator_state.json is kept"
  else
    fail "existing priv_validator_state.json is kept" "$(cat "$tmp/beacond/data/priv_validator_state.json")"
  fi
else
  fail "existing priv_validator_state.json is kept" "$(cat "$tmp/err")"
fi

echo
if [[ "$FAILS" -eq 0 ]]; then
  echo "All tests passed."
  echo
  exit 0
fi
echo "$FAILS test(s) failed."
exit 1
