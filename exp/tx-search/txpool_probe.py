#!/usr/bin/env python3
"""
txpool_probe.py

Samples Berachain RPC for txpool metrics and classifies queued transactions
by reason: nonce gaps vs pricing. Uses txpool_status and txpool_inspect.

Environment variables:
  - RPC_URL: RPC endpoint (default: https://rpc.berachain.com)
  - SAMPLES: integer, number of txpool_status samples (default: 30)
  - INSPECT_HITS: integer, number of txpool_inspect queries (default: 30)
  - GAS_PRICE_FLOOR_GWEI: float, node floor for gas price (default: 1.0)
  - SLEEP_MS_MIN: int, min sleep between requests in ms (default: 50)
  - SLEEP_MS_JITTER: int, extra random jitter in ms (default: 50)

Notes on "underpriced":
  - Transactions with gas price below the node's configured floor are typically
    rejected at admission time and do not appear in pending or queued sets.
  - However, EIP-1559 transactions whose maxFeePerGas is below the current
    base fee can appear in the pool but remain unexecutable; clients may keep
    them in the queue until base fee falls. We classify those as "under_basefee".
"""

from __future__ import annotations

import os
import time
import random
import json
import re
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests


def getenv_str(name: str, default: str) -> str:
    val = os.getenv(name)
    return val if val not in (None, "") else default


def getenv_int(name: str, default: int) -> int:
    val = os.getenv(name)
    if val is None or val == "":
        return default
    try:
        return int(val)
    except Exception:
        return default


def getenv_float(name: str, default: float) -> float:
    val = os.getenv(name)
    if val is None or val == "":
        return default
    try:
        return float(val)
    except Exception:
        return default


RPC_URL = getenv_str("RPC_URL", "https://rpc.berachain.com")
SAMPLES = getenv_int("SAMPLES", 30)
INSPECT_HITS = getenv_int("INSPECT_HITS", 30)
GAS_PRICE_FLOOR_GWEI = getenv_float("GAS_PRICE_FLOOR_GWEI", 1.0)
SLEEP_MS_MIN = getenv_int("SLEEP_MS_MIN", 50)
SLEEP_MS_JITTER = getenv_int("SLEEP_MS_JITTER", 50)
CONSOLIDATED_LIMIT = getenv_int("CONSOLIDATED_LIMIT", 50)

GWEI = 10**9
WEI_FLOOR = int(GAS_PRICE_FLOOR_GWEI * GWEI)


class RpcClient:
    def __init__(self, url: str, timeout: float = 5.0) -> None:
        self.url = url
        self.timeout = timeout
        self.session = requests.Session()

    def call(self, method: str, params: Optional[List[Any]] = None) -> Any:
        payload = {"jsonrpc": "2.0", "method": method, "params": params or [], "id": 1}
        r = self.session.post(self.url, json=payload, timeout=self.timeout)
        r.raise_for_status()
        data = r.json()
        if "error" in data and data["error"]:
            raise RuntimeError(f"RPC error: {data['error']}")
        return data.get("result")


def sleep_briefly() -> None:
    time.sleep((SLEEP_MS_MIN + random.randint(0, SLEEP_MS_JITTER)) / 1000.0)


def hex_to_int(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, int):
        return value
    s = str(value)
    if s.startswith("0x"):
        return int(s, 16)
    return int(s)


def get_pending_basefee_wei(rpc: RpcClient) -> int:
    try:
        blk = rpc.call("eth_getBlockByNumber", ["pending", False])
        return hex_to_int(blk.get("baseFeePerGas", "0x0")) if isinstance(blk, dict) else 0
    except Exception:
        return 0


INSPECT_FEE_REGEXES = [
    re.compile(r"feeCap\s*[:=]\s*(0x[0-9a-fA-F]+|\d+)", re.IGNORECASE),
    re.compile(r"maxFeePerGas\s*[:=]\s*(0x[0-9a-fA-F]+|\d+)", re.IGNORECASE),
]
INSPECT_TIP_REGEXES = [
    re.compile(r"tip\s*[:=]\s*(0x[0-9a-fA-F]+|\d+)", re.IGNORECASE),
    re.compile(r"maxPriorityFeePerGas\s*[:=]\s*(0x[0-9a-fA-F]+|\d+)", re.IGNORECASE),
]
INSPECT_GASPRICE_REGEXES = [
    re.compile(r"gasprice\s*[:=]\s*(0x[0-9a-fA-F]+|\d+)", re.IGNORECASE),
    re.compile(r"gasPrice\s*[:=]\s*(0x[0-9a-fA-F]+|\d+)", re.IGNORECASE),
]


def parse_int_from_patterns(text: str, patterns: Iterable[re.Pattern[str]]) -> Optional[int]:
    for pat in patterns:
        m = pat.search(text)
        if m:
            return hex_to_int(m.group(1))
    return None


def analyze() -> None:
    rpc = RpcClient(RPC_URL)

    # 1) Sample txpool_status to find maxima
    max_pending = 0
    max_queued = 0
    for _ in range(max(1, SAMPLES)):
        try:
            status = rpc.call("txpool_status") or {}
            p = hex_to_int(status.get("pending", 0))
            q = hex_to_int(status.get("queued", 0))
            if p > max_pending:
                max_pending = p
            if q > max_queued:
                max_queued = q
        except Exception:
            pass
        sleep_briefly()

    # 2) Collate txpool_inspect across many hits
    # We build maps of address->set(nonces) for pending/queued and
    # capture queued entries to classify by reason.
    pending_nonces: Dict[str, set[int]] = {}
    queued_entries: List[Tuple[str, int, str]] = []  # (from, nonce, summary)

    # Cache next nonces per address to avoid hammering RPC excessively
    next_nonce_cache: Dict[str, int] = {}

    reasons_count = {"nonce_gap": 0, "below_floor": 0, "under_basefee": 0, "unknown": 0}
    reasons_by_sender: Dict[str, Dict[str, int]] = {}

    for _ in range(max(1, INSPECT_HITS)):
        basefee_wei = get_pending_basefee_wei(rpc)
        try:
            insp = rpc.call("txpool_inspect") or {}
        except Exception:
            sleep_briefly()
            continue

        # Harvest pending nonces by address
        pending_map = insp.get("pending") or {}
        if isinstance(pending_map, dict):
            for addr, nonce_map in pending_map.items():
                a = str(addr).lower()
                s = pending_nonces.setdefault(a, set())
                if isinstance(nonce_map, dict):
                    for nonce_str in nonce_map.keys():
                        try:
                            nonce = int(nonce_str, 0)
                        except Exception:
                            try:
                                nonce = int(str(nonce_str), 16) if str(nonce_str).startswith("0x") else int(nonce_str)
                            except Exception:
                                continue
                        s.add(nonce)

        # Collect queued entries
        queued_map = insp.get("queued") or {}
        if isinstance(queued_map, dict):
            for addr, nonce_map in queued_map.items():
                a = str(addr).lower()
                if isinstance(nonce_map, dict):
                    for nonce_str, summary in nonce_map.items():
                        try:
                            nonce = int(nonce_str, 0)
                        except Exception:
                            try:
                                nonce = int(str(nonce_str), 16) if str(nonce_str).startswith("0x") else int(nonce_str)
                            except Exception:
                                continue
                        queued_entries.append((a, nonce, str(summary)))

        sleep_briefly()

    # Unique queued entries
    queued_entries = list({(a, n, s) for (a, n, s) in queued_entries})

    # Build queued_nonces_by_addr for consolidated view
    queued_nonces_by_addr: Dict[str, set[int]] = {}
    for a, n, _s in queued_entries:
        queued_nonces_by_addr.setdefault(a, set()).add(n)

    # Helper to fetch next nonce for an address (pending state)
    def get_next_nonce(addr: str) -> int:
        if addr in next_nonce_cache:
            return next_nonce_cache[addr]
        try:
            nn_hex = rpc.call("eth_getTransactionCount", [addr, "pending"]) or "0x0"
            nn = hex_to_int(nn_hex)
        except Exception:
            nn = 0
        next_nonce_cache[addr] = nn
        return nn

    # Classify queued entries (using CONSOLIDATED union of pending across workers)
    for addr, nonce, summary in queued_entries:
        # Reason: nonce gap
        nn = get_next_nonce(addr)
        pending_for_addr = pending_nonces.get(addr, set())
        has_all_prior = all((n in pending_for_addr) for n in range(nn, max(nn, nonce)))
        is_nonce_gap = nonce > nn and not has_all_prior

        if is_nonce_gap:
            reason = "nonce_gap"
        else:
            # Try to infer pricing
            fee_cap = parse_int_from_patterns(summary, INSPECT_FEE_REGEXES)
            tip_cap = parse_int_from_patterns(summary, INSPECT_TIP_REGEXES)
            gas_price = parse_int_from_patterns(summary, INSPECT_GASPRICE_REGEXES)

            reason = "unknown"
            if gas_price is not None:
                # Legacy-style price seen in summary
                if gas_price < max(WEI_FLOOR, 0):
                    reason = "below_floor"
            elif fee_cap is not None:
                # EIP-1559-style: if fee cap < basefee, cannot be included now
                basefee_now = get_pending_basefee_wei(rpc)
                if fee_cap < basefee_now:
                    reason = "under_basefee"

        reasons_count[reason] = reasons_count.get(reason, 0) + 1
        bucket = reasons_by_sender.setdefault(addr, {})
        bucket[reason] = bucket.get(reason, 0) + 1

    # Consolidated per-sender view across workers
    consolidated_rows: List[Dict[str, Any]] = []
    addrs = set(pending_nonces.keys()) | set(queued_nonces_by_addr.keys())

    def summarize_addr(a: str) -> Dict[str, Any]:
        pn = sorted(pending_nonces.get(a, set()))
        qn = sorted(queued_nonces_by_addr.get(a, set()))
        nn = get_next_nonce(a)
        # Find first nonce >= next_nonce that is not present in pending
        first_gap = nn
        while first_gap in pending_nonces.get(a, set()):
            first_gap += 1
        has_union_gap = any(q > nn for q in qn) and (first_gap < (min(qn) if qn else first_gap))
        return {
            "address": a,
            "next_nonce": nn,
            "pending_count": len(pn),
            "queued_count": len(qn),
            "pending_min": (pn[0] if pn else None),
            "pending_max": (pn[-1] if pn else None),
            "queued_min": (qn[0] if qn else None),
            "queued_max": (qn[-1] if qn else None),
            "first_gap_nonce": first_gap,
            "has_union_nonce_gap": has_union_gap,
            "reasons": reasons_by_sender.get(a, {}),
        }

    for a in addrs:
        consolidated_rows.append(summarize_addr(a))

    # Count addresses that truly have a nonce gap considering unionized pending
    synthesized_gap_addresses = sum(1 for row in consolidated_rows if row["has_union_nonce_gap"])            

    # Output summary
    print(json.dumps({
        "rpc_url": RPC_URL,
        "samples": SAMPLES,
        "inspect_hits": INSPECT_HITS,
        "gas_price_floor_gwei": GAS_PRICE_FLOOR_GWEI,
        "max_pending": max_pending,
        "max_queued": max_queued,
        "queued_unique": len(queued_entries),
        "queued_reasons": reasons_count,
        "synthesized_nonce_gap_addresses": synthesized_gap_addresses,
        "top_senders": sorted(
            (
                (addr, sum(counts.values()))
                for addr, counts in reasons_by_sender.items()
            ),
            key=lambda kv: kv[1],
            reverse=True
        )[:10],
        "consolidated_limit": CONSOLIDATED_LIMIT,
        "consolidated": sorted(
            (
                {
                    k: v for k, v in row.items()
                }
                for row in consolidated_rows
            ),
            key=lambda r: (r["queued_count"], r["pending_count"]) ,
            reverse=True
        )[:CONSOLIDATED_LIMIT],
    }, indent=2))

    # Short human note about underpriced
    print()
    print("Note: transactions below the node's floor are generally rejected and will not" \
          " appear in pending or queued. EIP-1559 fee-capped txs below base fee may" \
          " be retained in the queue until base fee drops.")


if __name__ == "__main__":
    analyze()


