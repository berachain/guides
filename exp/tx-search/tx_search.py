#!/usr/bin/env python3
"""
tx_search.py

Searches Berachain RPC cluster for specific transaction IDs in the mempool.
Uses txpool_inspect to find transactions across multiple RPC hits.

Usage:
  python3 tx_search.py --hashes 0x123...,0x456...
  python3 tx_search.py --addresses 0xabc...,0xdef...
  python3 tx_search.py --hashes 0x123... --addresses 0xabc...
  python3 tx_search.py --hashes 0x123... --rpc-url https://bepolia.rpc.berachain.com
"""

from __future__ import annotations

import os
import time
import random
import json
import sys
import argparse
from typing import Any, Dict, List, Optional, Set, Tuple

import requests


def parse_arguments() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Search Berachain RPC cluster for transactions in the mempool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 tx_search.py --hashes 0x123...,0x456...
  python3 tx_search.py --addresses 0xabc...,0xdef...
  python3 tx_search.py --hashes 0x123... --addresses 0xabc...
  python3 tx_search.py --hashes 0x123... --rpc-url https://bepolia.rpc.berachain.com
  python3 tx_search.py --addresses 0xabc... --hits 100 --sleep 200
        """
    )
    
    parser.add_argument(
        "--hashes",
        type=str,
        help="Comma-separated list of transaction hashes to search for"
    )
    
    parser.add_argument(
        "--addresses", 
        type=str,
        help="Comma-separated list of sender addresses to search for"
    )
    
    parser.add_argument(
        "--rpc-url",
        type=str,
        default="https://rpc.berachain.com",
        help="RPC endpoint URL (default: https://rpc.berachain.com)"
    )
    
    parser.add_argument(
        "--hits",
        type=int,
        default=50,
        help="Number of txpool_inspect queries (default: 50)"
    )
    
    parser.add_argument(
        "--sleep",
        type=int,
        default=100,
        help="Min sleep between requests in ms (default: 100)"
    )
    
    parser.add_argument(
        "--jitter",
        type=int,
        default=50,
        help="Extra random jitter in ms (default: 50)"
    )
    
    parser.add_argument(
        "--timeout",
        type=float,
        default=5.0,
        help="RPC request timeout in seconds (default: 5.0)"
    )
    
    return parser.parse_args()


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


def sleep_briefly(sleep_min: int, sleep_jitter: int) -> None:
    time.sleep((sleep_min + random.randint(0, sleep_jitter)) / 1000.0)


def normalize_tx_hash(tx_hash: str) -> str:
    """Normalize transaction hash to lowercase with 0x prefix."""
    tx_hash = tx_hash.strip()
    if not tx_hash.startswith("0x"):
        tx_hash = "0x" + tx_hash
    return tx_hash.lower()


def normalize_address(addr: str) -> str:
    """Normalize address to lowercase with 0x prefix."""
    addr = addr.strip()
    if not addr.startswith("0x"):
        addr = "0x" + addr
    return addr.lower()


def parse_tx_hashes(tx_hashes_str: str) -> List[str]:
    """Parse comma-separated transaction hashes."""
    if not tx_hashes_str:
        return []
    
    hashes = []
    for tx_hash in tx_hashes_str.split(","):
        tx_hash = tx_hash.strip()
        if tx_hash:
            hashes.append(normalize_tx_hash(tx_hash))
    
    return hashes


def parse_tx_addresses(tx_addrs_str: str) -> List[str]:
    """Parse comma-separated sender addresses."""
    if not tx_addrs_str:
        return []
    
    addrs = []
    for addr in tx_addrs_str.split(","):
        addr = addr.strip()
        if addr:
            addrs.append(normalize_address(addr))
    
    return addrs


def search_transactions(args: argparse.Namespace) -> None:
    # Parse transaction hashes and addresses
    target_hashes = parse_tx_hashes(args.hashes or "")
    target_addresses = parse_tx_addresses(args.addresses or "")
    
    if not target_hashes and not target_addresses:
        print("Error: No transaction hashes or addresses provided.")
        print("Use --hashes and/or --addresses command line options.")
        print("Run with --help for usage examples.")
        sys.exit(1)
    
    print(f"Searching for:")
    if target_hashes:
        print(f"  {len(target_hashes)} transaction hash(es):")
        for tx_hash in target_hashes:
            print(f"    - {tx_hash}")
    if target_addresses:
        print(f"  {len(target_addresses)} sender address(es):")
        for addr in target_addresses:
            print(f"    - {addr}")
    print()
    
    rpc = RpcClient(args.rpc_url, args.timeout)
    
    # Track found transactions
    found_transactions: Dict[str, Dict[str, Any]] = {}
    found_by_address: Dict[str, List[Dict[str, Any]]] = {}
    search_stats = {
        "total_hits": 0,
        "successful_hits": 0,
        "failed_hits": 0,
        "pending_searches": 0,
        "queued_searches": 0,
    }
    
    # Search through txpool_inspect multiple times
    for hit_num in range(1, args.hits + 1):
        search_stats["total_hits"] += 1
        
        try:
            print(f"Hit {hit_num}/{args.hits}...", end=" ", flush=True)
            insp = rpc.call("txpool_inspect") or {}
            search_stats["successful_hits"] += 1
            
            # Search pending transactions
            pending_map = insp.get("pending") or {}
            if isinstance(pending_map, dict):
                search_stats["pending_searches"] += 1
                for addr, nonce_map in pending_map.items():
                    addr_normalized = normalize_address(str(addr))
                    if isinstance(nonce_map, dict):
                        for nonce_str, tx_data in nonce_map.items():
                            if isinstance(tx_data, dict) and "hash" in tx_data:
                                tx_hash = normalize_tx_hash(tx_data["hash"])
                                nonce = int(nonce_str, 0) if str(nonce_str).startswith("0x") else int(nonce_str)
                                
                                # Check if this transaction matches our search criteria
                                tx_info = {
                                    "status": "pending",
                                    "address": addr_normalized,
                                    "nonce": nonce,
                                    "data": tx_data,
                                    "found_in_hit": hit_num,
                                }
                                
                                # Match by transaction hash
                                if tx_hash in target_hashes:
                                    found_transactions[tx_hash] = tx_info
                                
                                # Match by sender address
                                if addr_normalized in target_addresses:
                                    if addr_normalized not in found_by_address:
                                        found_by_address[addr_normalized] = []
                                    found_by_address[addr_normalized].append(tx_info)
            
            # Search queued transactions
            queued_map = insp.get("queued") or {}
            if isinstance(queued_map, dict):
                search_stats["queued_searches"] += 1
                for addr, nonce_map in queued_map.items():
                    addr_normalized = normalize_address(str(addr))
                    if isinstance(nonce_map, dict):
                        for nonce_str, tx_data in nonce_map.items():
                            if isinstance(tx_data, dict) and "hash" in tx_data:
                                tx_hash = normalize_tx_hash(tx_data["hash"])
                                nonce = int(nonce_str, 0) if str(nonce_str).startswith("0x") else int(nonce_str)
                                
                                # Check if this transaction matches our search criteria
                                tx_info = {
                                    "status": "queued",
                                    "address": addr_normalized,
                                    "nonce": nonce,
                                    "data": tx_data,
                                    "found_in_hit": hit_num,
                                }
                                
                                # Match by transaction hash
                                if tx_hash in target_hashes:
                                    found_transactions[tx_hash] = tx_info
                                
                                # Match by sender address
                                if addr_normalized in target_addresses:
                                    if addr_normalized not in found_by_address:
                                        found_by_address[addr_normalized] = []
                                    found_by_address[addr_normalized].append(tx_info)
            
            print("✓")
            
        except Exception as e:
            search_stats["failed_hits"] += 1
            print(f"✗ ({str(e)[:50]}...)")
        
        # Check if we found all transactions (only for hash-based searches)
        if target_hashes and len(found_transactions) == len(target_hashes):
            print(f"\nAll {len(target_hashes)} transactions found! Stopping early.")
            break
        
        sleep_briefly(args.sleep, args.jitter)
    
    # Output results
    print("\n" + "="*60)
    print("SEARCH RESULTS")
    print("="*60)
    
    print(f"\nSearch Statistics:")
    print(f"  Total RPC hits: {search_stats['total_hits']}")
    print(f"  Successful hits: {search_stats['successful_hits']}")
    print(f"  Failed hits: {search_stats['failed_hits']}")
    print(f"  Pending searches: {search_stats['pending_searches']}")
    print(f"  Queued searches: {search_stats['queued_searches']}")
    
    # Calculate totals
    total_found_hashes = len(found_transactions)
    total_found_by_addr = sum(len(txs) for txs in found_by_address.values())
    
    print(f"\nSearch Results:")
    if target_hashes:
        print(f"  Transaction Hashes Found: {total_found_hashes}/{len(target_hashes)}")
        missing_hashes = [tx_hash for tx_hash in target_hashes if tx_hash not in found_transactions]
        if missing_hashes:
            print(f"  Missing Hashes: {len(missing_hashes)}")
    
    if target_addresses:
        print(f"  Transactions by Address: {total_found_by_addr} total")
        for addr in target_addresses:
            count = len(found_by_address.get(addr, []))
            print(f"    {addr}: {count} transactions")
    
    # Show found transactions by hash
    if found_transactions:
        print(f"\nFound Transactions (by hash):")
        for tx_hash in target_hashes:
            if tx_hash in found_transactions:
                tx_info = found_transactions[tx_hash]
                print(f"\n  {tx_hash}:")
                print(f"    Status: {tx_info['status']}")
                print(f"    Address: {tx_info['address']}")
                print(f"    Nonce: {tx_info['nonce']}")
                print(f"    Found in hit: {tx_info['found_in_hit']}")
                
                # Show transaction data if available
                tx_data = tx_info.get('data', {})
                if tx_data:
                    print(f"    Gas Price: {tx_data.get('gasPrice', 'N/A')}")
                    print(f"    Gas Limit: {tx_data.get('gas', 'N/A')}")
                    print(f"    To: {tx_data.get('to', 'N/A')}")
                    print(f"    Value: {tx_data.get('value', 'N/A')}")
            else:
                print(f"\n  {tx_hash}: NOT FOUND")
    
    # Show found transactions by address
    if found_by_address:
        print(f"\nFound Transactions (by address):")
        for addr, txs in found_by_address.items():
            print(f"\n  Address: {addr} ({len(txs)} transactions)")
            for tx_info in sorted(txs, key=lambda x: x['nonce']):
                tx_data = tx_info.get('data', {})
                tx_hash = tx_data.get('hash', 'N/A')
                print(f"    Nonce {tx_info['nonce']}: {tx_hash} ({tx_info['status']})")
                print(f"      Gas Price: {tx_data.get('gasPrice', 'N/A')}")
                print(f"      To: {tx_data.get('to', 'N/A')}")
                print(f"      Value: {tx_data.get('value', 'N/A')}")
    
    # Show missing transactions
    if target_hashes:
        missing_hashes = [tx_hash for tx_hash in target_hashes if tx_hash not in found_transactions]
        if missing_hashes:
            print(f"\nMissing Transaction Hashes:")
            for tx_hash in missing_hashes:
                print(f"  - {tx_hash}")
    
    # JSON output for programmatic use
    print(f"\n" + "="*60)
    print("JSON OUTPUT")
    print("="*60)
    
    result = {
        "rpc_url": args.rpc_url,
        "search_hits": args.hits,
        "target_hashes": target_hashes,
        "target_addresses": target_addresses,
        "search_stats": search_stats,
        "found_by_hash": {
            "count": len(found_transactions),
            "missing_count": len(target_hashes) - len(found_transactions) if target_hashes else 0,
            "transactions": found_transactions,
            "missing_hashes": [tx_hash for tx_hash in target_hashes if tx_hash not in found_transactions] if target_hashes else [],
        },
        "found_by_address": {
            "count": total_found_by_addr,
            "addresses": {addr: len(txs) for addr, txs in found_by_address.items()},
            "transactions": found_by_address,
        },
    }
    
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    args = parse_arguments()
    search_transactions(args)
