#!/bin/sh
# Test-only beacond stub for VC drivers.
if echo "$*" | grep -q validator-keys; then
  echo "Eth/Beacon Pubkey (Compressed 48-byte Hex):"
  echo "${VC_PUBKEY:-0xabababababababababababababababababababababababababababababababababababababababababababababab}"
  exit 0
fi
if echo "$*" | grep -q validator-root; then
  echo "0x3cbcf75b02fe4750c592f1c1ff8b5500a74406f80f038e9ff250e2e294c5615e"
  exit 0
fi
if echo "$*" | grep -q create-validator; then
  vault=$(echo "$*" | tr ' ' '\n' | grep -E '^0x[0-9a-fA-F]{40}$' | head -1)
  wc="0x010000000000000000000000${vault#0x}"
  echo "pubkey: ${VC_PUBKEY}"
  echo "credentials: $wc"
  echo "signature: 0x$(printf '11%.0s' $(seq 1 96))"
  echo "amount: 10000000000000"
  exit 0
fi
if echo "$*" | grep -q validate; then
  echo ok
  exit 0
fi
exit 0
