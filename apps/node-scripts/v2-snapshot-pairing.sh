#!/usr/bin/env bash
# Resolve storage-v2 catalog pairing for experimental mkberanode installs (BERA-639).
# Can be sourced or invoked as:
#   v2-snapshot-pairing.sh resolve <catalog.csv> <pruned|minimal|archive|full_archive>
set -eu
if (set -o pipefail) 2>/dev/null; then :; fi

V2_DEFAULT_CATALOG_URL="https://bera-snapshots.fsn1.your-objectstorage.com/v2/bepolia/catalog.csv"

v2_pairing_for_mode() {
  local mode="$1"
  case "$mode" in
    minimal|pruned)
      V2_EL_PRESET="--minimal"
      V2_CL_ROLE="cl-pruned"
      ;;
    archive)
      V2_EL_PRESET="--archive"
      V2_CL_ROLE="cl-pruned"
      ;;
    full_archive)
      V2_EL_PRESET="--archive"
      V2_CL_ROLE="cl-archive"
      ;;
    *)
      echo "unsupported storage_mode for v2: $mode" >&2
      return 1
      ;;
  esac
}

v2_select_from_catalog() {
  local catalog_file="$1"
  local mode="$2"
  local role=""
  local el_url="" cl_url=""
  local header type layer profile block size created key url row_role

  v2_pairing_for_mode "$mode" || return 1

  IFS= read -r header < "$catalog_file" || true
  if [[ "$header" != "type,layer,profile,block_number,size_bytes,created_at,object_key,download_url,role" ]]; then
    echo "invalid v2 catalog header: $header" >&2
    return 1
  fi

  el_url=""
  cl_url=""
  while IFS=, read -r type layer profile block size created key url row_role; do
    [[ "$type" == "type" ]] && continue
    case "$row_role" in
      el-manifest)
        if [[ -n "$el_url" ]]; then
          echo "duplicate el-manifest in catalog" >&2
          return 1
        fi
        el_url="$url"
        ;;
      cl-pruned|cl-archive)
        if [[ "$row_role" == "$V2_CL_ROLE" ]]; then
          if [[ -n "$cl_url" ]]; then
            echo "duplicate $V2_CL_ROLE in catalog" >&2
            return 1
          fi
          cl_url="$url"
        fi
        ;;
    esac
  done < "$catalog_file"

  if [[ -z "$el_url" || -z "$cl_url" ]]; then
    echo "catalog missing required rows for mode=$mode (need el-manifest + $V2_CL_ROLE)" >&2
    return 1
  fi

  V2_EL_MANIFEST_URL="$el_url"
  V2_CL_URL="$cl_url"
}

v2_print_resolution() {
  local mode="$1"
  printf 'MODE=%s\n' "$mode"
  printf 'EL_MANIFEST_URL=%s\n' "$V2_EL_MANIFEST_URL"
  printf 'CL_URL=%s\n' "$V2_CL_URL"
  printf 'CL_ROLE=%s\n' "$V2_CL_ROLE"
  printf 'EL_PRESET=%s\n' "$V2_EL_PRESET"
  printf 'DOWNLOAD_CMD=bera-reth download --chain bepolia --datadir <el-datadir> --manifest-url %s %s\n' \
    "$V2_EL_MANIFEST_URL" "$V2_EL_PRESET"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if [[ "${1:-}" != "resolve" || $# -ne 3 ]]; then
    echo "usage: $0 resolve <catalog.csv> <pruned|minimal|archive|full_archive>" >&2
    exit 2
  fi
  v2_select_from_catalog "$2" "$3" || exit 1
  v2_print_resolution "$3"
fi
