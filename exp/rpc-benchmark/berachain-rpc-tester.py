#!/usr/bin/env python3
"""
Berachain RPC Throughput Tester

This script performs intensive RPC testing against a Berachain mainnet node to measure
throughput and performance. It uses a variety of eth_call methods targeting different
contracts to simulate diverse real-world traffic patterns.

Usage:
    python berachain-rpc-tester.py --rpc-url https://rpc.berachain.com/ --duration 60

Key features:
- Tests multiple contract function calls via eth_call
- Measures latency, throughput, and error rates
- Provides detailed statistics and reporting
- Supports concurrent request patterns
- Includes circuit breaker for error rate monitoring
"""

import asyncio
import aiohttp
import argparse
import json
import time
import statistics
import random
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from collections import defaultdict, deque
import logging
import sys

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@dataclass
class RPCCallConfig:
    """Configuration for an RPC call"""
    name: str
    method: str = "eth_call"
    to: str = ""
    data: str = ""
    description: str = ""
    supports_historical: bool = True  # Whether this call can be made at historical blocks

@dataclass
class RPCResult:
    """Result of an RPC call"""
    success: bool
    latency: float
    call_name: str
    error: Optional[str] = None
    response_size: int = 0
    block_number: Optional[int] = None  # Block number for historical calls

@dataclass
class TestStats:
    """Statistics for the test run"""
    total_calls: int = 0
    successful_calls: int = 0
    failed_calls: int = 0
    total_time: float = 0.0
    latencies: List[float] = field(default_factory=list)
    error_types: Dict[str, int] = field(default_factory=lambda: defaultdict(int))
    calls_by_type: Dict[str, int] = field(default_factory=lambda: defaultdict(int))
    successful_by_type: Dict[str, int] = field(default_factory=lambda: defaultdict(int))
    historical_calls: int = 0
    historical_successful: int = 0
    historical_latencies: List[float] = field(default_factory=list)

class CircuitBreaker:
    """Simple circuit breaker to prevent overwhelming a failing node"""
    
    def __init__(self, failure_threshold: float = 0.5, recovery_time: int = 30):
        self.failure_threshold = failure_threshold
        self.recovery_time = recovery_time
        self.recent_calls = deque(maxlen=100)
        self.last_failure_time = 0
        self.is_open = False
    
    def record_call(self, success: bool):
        """Record the result of a call"""
        self.recent_calls.append(success)
        
        if len(self.recent_calls) >= 10:
            failure_rate = 1 - (sum(self.recent_calls) / len(self.recent_calls))
            
            if failure_rate > self.failure_threshold:
                self.is_open = True
                self.last_failure_time = time.time()
                logger.warning(f"Circuit breaker opened - failure rate: {failure_rate:.2%}")
    
    def can_call(self) -> bool:
        """Check if calls are allowed"""
        if not self.is_open:
            return True
        
        if time.time() - self.last_failure_time > self.recovery_time:
            self.is_open = False
            logger.info("Circuit breaker closed - attempting recovery")
            return True
        
        return False

class BerachainRPCTester:
    """Main RPC testing class"""
    
    def __init__(self, rpc_url: str, max_concurrent: int = 50, 
                 test_archive: bool = False, archive_blocks: int = 3_000_000):
        self.rpc_url = rpc_url
        self.max_concurrent = max_concurrent
        self.test_archive = test_archive
        self.archive_blocks = archive_blocks
        self.stats = TestStats()
        self.circuit_breaker = CircuitBreaker()
        self.current_block = None
        self.min_archive_block = None
        
        # Berachain mainnet contract addresses and function calls
        self.rpc_calls = [
            # BGT Token calls
            RPCCallConfig(
                name="bgt_totalSupply",
                to="0x656b95E550C07a9ffe548bd4085c72418Ceb1dba",
                data="0x18160ddd",  # totalSupply()
                description="BGT total supply"
            ),
            RPCCallConfig(
                name="bgt_balanceOf_zero",
                to="0x656b95E550C07a9ffe548bd4085c72418Ceb1dba",
                data="0x70a082310000000000000000000000000000000000000000000000000000000000000000",  # balanceOf(0x0)
                description="BGT balance of zero address"
            ),
            RPCCallConfig(
                name="bgt_balanceOf_validator1",
                to="0x656b95E550C07a9ffe548bd4085c72418Ceb1dba",
                data="0x70a082310000000000000000000000004f4a5c2194b8e856b7a05b348f6ba3978fb6f6d5",  # balanceOf(governance)
                description="BGT balance of governance address"
            ),
            RPCCallConfig(
                name="bgt_balanceOf_validator2", 
                to="0x656b95E550C07a9ffe548bd4085c72418Ceb1dba",
                data="0x70a08231000000000000000000000000df960e8f3f19c481dde769ededd439ea1a63426a",  # balanceOf(berachef)
                description="BGT balance of BeraChef address"
            ),
            RPCCallConfig(
                name="bgt_minter",
                to="0x656b95E550C07a9ffe548bd4085c72418Ceb1dba",
                data="0x07546172",  # minter()
                description="BGT minter address"
            ),
            
            # HONEY Token calls
            RPCCallConfig(
                name="honey_totalSupply",
                to="0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce",
                data="0x18160ddd",  # totalSupply()
                description="HONEY total supply"
            ),
            RPCCallConfig(
                name="honey_name",
                to="0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce",
                data="0x06fdde03",  # name()
                description="HONEY token name"
            ),
            RPCCallConfig(
                name="honey_symbol",
                to="0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce",
                data="0x95d89b41",  # symbol()
                description="HONEY token symbol"
            ),
            
            # WBERA Token calls
            RPCCallConfig(
                name="wbera_totalSupply",
                to="0x6969696969696969696969696969696969696969",
                data="0x18160ddd",  # totalSupply()
                description="WBERA total supply"
            ),
            RPCCallConfig(
                name="wbera_name",
                to="0x6969696969696969696969696969696969696969",
                data="0x06fdde03",  # name()
                description="WBERA token name"
            ),
            
            # More BGT balance checks for various accounts
            RPCCallConfig(
                name="bgt_balanceOf_vault",
                to="0x656b95E550C07a9ffe548bd4085c72418Ceb1dba",
                data="0x70a082310000000000000000000000004be03f781c497a489e3cb0287833452ca9b9e80b",  # balanceOf(vault)
                description="BGT balance of BEX Vault"
            ),
            RPCCallConfig(
                name="bgt_balanceOf_honey",
                to="0x656b95E550C07a9ffe548bd4085c72418Ceb1dba", 
                data="0x70a08231000000000000000000000000fcbd14dc51f0a4d49d5e53c2e0950e0bc26d0dce",  # balanceOf(honey)
                description="BGT balance of HONEY contract"
            ),
            RPCCallConfig(
                name="bgt_balanceOf_wbera",
                to="0x656b95E550C07a9ffe548bd4085c72418Ceb1dba",
                data="0x70a082310000000000000000000000006969696969696969696969696969696969696969",  # balanceOf(wbera)
                description="BGT balance of WBERA contract"
            ),
            
            # BEX Vault calls
            RPCCallConfig(
                name="vault_getAuthorizer",
                to="0x4Be03f781C497A489E3cB0287833452cA9b9E80B",
                data="0xaaabadc5",  # getAuthorizer()
                description="BEX Vault authorizer"
            ),
            RPCCallConfig(
                name="vault_getProtocolFeesCollector",
                to="0x4Be03f781C497A489E3cB0287833452cA9b9E80B",
                data="0xd2946c2b",  # getProtocolFeesCollector()
                description="BEX Vault protocol fees collector"
            ),
            
            # Governance calls
            RPCCallConfig(
                name="gov_votingDelay",
                to="0x4f4A5c2194B8e856b7a05B348F6ba3978FB6f6D5",
                data="0x3932abb1",  # votingDelay()
                description="Governance voting delay"
            ),
            RPCCallConfig(
                name="gov_votingPeriod",
                to="0x4f4A5c2194B8e856b7a05B348F6ba3978FB6f6D5",
                data="0x02a251a3",  # votingPeriod()
                description="Governance voting period"
            ),
            
            # Additional working contract calls
            RPCCallConfig(
                name="honey_decimals",
                to="0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce",
                data="0x313ce567",  # decimals()
                description="HONEY token decimals"
            ),
            RPCCallConfig(
                name="wbera_decimals",
                to="0x6969696969696969696969696969696969696969",
                data="0x313ce567",  # decimals()
                description="WBERA token decimals"
            ),
            
            # Standard ETH calls
            RPCCallConfig(
                name="eth_blockNumber",
                method="eth_blockNumber",
                description="Latest block number",
                supports_historical=False
            ),
            RPCCallConfig(
                name="eth_gasPrice",
                method="eth_gasPrice",
                description="Current gas price",
                supports_historical=False
            ),
            RPCCallConfig(
                name="net_version",
                method="net_version",
                description="Network version",
                supports_historical=False
            ),
        ]
    
    async def get_current_block(self, session: aiohttp.ClientSession) -> Optional[int]:
        """Get the current block number"""
        try:
            payload = {
                "jsonrpc": "2.0",
                "method": "eth_blockNumber",
                "params": [],
                "id": 1
            }
            
            async with session.post(self.rpc_url, json=payload, timeout=aiohttp.ClientTimeout(total=5)) as response:
                if response.status == 200:
                    data = await response.json()
                    if "result" in data:
                        return int(data["result"], 16)
        except Exception as e:
            logger.warning(f"Failed to get current block: {e}")
        
        return None
    
    def get_random_historical_block(self) -> Optional[int]:
        """Get a random historical block number for archive testing"""
        if self.min_archive_block is None or self.current_block is None:
            return None
        
        return random.randint(self.min_archive_block, self.current_block - 100)
    
    async def make_rpc_call(self, session: aiohttp.ClientSession, call_config: RPCCallConfig, 
                           block_number: Optional[int] = None) -> RPCResult:
        """Make a single RPC call"""
        if not self.circuit_breaker.can_call():
            return RPCResult(
                success=False,
                latency=0.0,
                call_name=call_config.name,
                error="Circuit breaker open",
                block_number=block_number
            )
        
        start_time = time.time()
        
        try:
            if call_config.method == "eth_call":
                # Use specific block number for historical calls, otherwise "latest"
                block_param = f"0x{block_number:x}" if block_number is not None else "latest"
                
                payload = {
                    "jsonrpc": "2.0",
                    "method": "eth_call",
                    "params": [
                        {
                            "to": call_config.to,
                            "data": call_config.data
                        },
                        block_param
                    ],
                    "id": 1
                }
            else:
                payload = {
                    "jsonrpc": "2.0",
                    "method": call_config.method,
                    "params": [],
                    "id": 1
                }
            
            async with session.post(
                self.rpc_url,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                latency = time.time() - start_time
                response_text = await response.text()
                response_data = json.loads(response_text)
                
                if response.status == 200 and "error" not in response_data:
                    result = RPCResult(
                        success=True,
                        latency=latency,
                        call_name=call_config.name,
                        response_size=len(response_text),
                        block_number=block_number
                    )
                    self.circuit_breaker.record_call(True)
                    return result
                else:
                    error_msg = response_data.get("error", {}).get("message", f"HTTP {response.status}")
                    result = RPCResult(
                        success=False,
                        latency=latency,
                        call_name=call_config.name,
                        error=error_msg,
                        block_number=block_number
                    )
                    self.circuit_breaker.record_call(False)
                    return result
        
        except asyncio.TimeoutError:
            latency = time.time() - start_time
            result = RPCResult(
                success=False,
                latency=latency,
                call_name=call_config.name,
                error="Timeout",
                block_number=block_number
            )
            self.circuit_breaker.record_call(False)
            return result
        
        except Exception as e:
            latency = time.time() - start_time
            result = RPCResult(
                success=False,
                latency=latency,
                call_name=call_config.name,
                error=str(e),
                block_number=block_number
            )
            self.circuit_breaker.record_call(False)
            return result
    
    async def run_test_batch(self, session: aiohttp.ClientSession, duration: int):
        """Run a batch of tests for the specified duration"""
        start_time = time.time()
        end_time = start_time + duration
        call_index = 0
        
        semaphore = asyncio.Semaphore(self.max_concurrent)
        
        async def bounded_call(call_config, block_num=None):
            async with semaphore:
                return await self.make_rpc_call(session, call_config, block_num)
        
        while time.time() < end_time:
            # Create a batch of concurrent calls
            tasks = []
            for _ in range(min(self.max_concurrent, len(self.rpc_calls))):
                call_config = self.rpc_calls[call_index % len(self.rpc_calls)]
                
                # Determine if this should be a historical call
                block_num = None
                if (self.test_archive and call_config.supports_historical and 
                    random.random() < 0.3):  # 30% chance for historical call
                    block_num = self.get_random_historical_block()
                
                tasks.append(bounded_call(call_config, block_num))
                call_index += 1
            
            # Execute batch
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Process results
            for result in results:
                if isinstance(result, RPCResult):
                    self.update_stats(result)
                else:
                    # Handle exceptions
                    self.stats.failed_calls += 1
                    self.stats.error_types["Exception"] += 1
            
            # Brief pause to prevent overwhelming
            await asyncio.sleep(0.01)
    
    def update_stats(self, result: RPCResult):
        """Update test statistics with a result"""
        self.stats.total_calls += 1
        self.stats.calls_by_type[result.call_name] += 1
        
        # Track historical vs current calls
        if result.block_number is not None:
            self.stats.historical_calls += 1
        
        if result.success:
            self.stats.successful_calls += 1
            self.stats.successful_by_type[result.call_name] += 1
            self.stats.latencies.append(result.latency)
            
            # Track historical success
            if result.block_number is not None:
                self.stats.historical_successful += 1
                self.stats.historical_latencies.append(result.latency)
        else:
            self.stats.failed_calls += 1
            self.stats.error_types[result.error or "Unknown"] += 1
    
    async def run_test(self, duration: int = 60):
        """Run the complete RPC test"""
        logger.info(f"Starting RPC throughput test against {self.rpc_url}")
        logger.info(f"Test duration: {duration} seconds")
        logger.info(f"Max concurrent requests: {self.max_concurrent}")
        logger.info(f"Testing {len(self.rpc_calls)} different RPC call types")
        
        if self.test_archive:
            logger.info(f"Archive node testing enabled - will query up to {self.archive_blocks:,} blocks back")
        
        start_time = time.time()
        
        connector = aiohttp.TCPConnector(limit=self.max_concurrent * 2)
        timeout = aiohttp.ClientTimeout(total=10)
        
        async with aiohttp.ClientSession(
            connector=connector,
            timeout=timeout,
            headers={"Content-Type": "application/json"}
        ) as session:
            # Initialize current block and archive range for historical testing
            if self.test_archive:
                self.current_block = await self.get_current_block(session)
                if self.current_block:
                    self.min_archive_block = max(1, self.current_block - self.archive_blocks)
                    logger.info(f"Current block: {self.current_block:,}")
                    logger.info(f"Archive range: {self.min_archive_block:,} to {self.current_block:,}")
                else:
                    logger.warning("Could not determine current block - disabling archive testing")
                    self.test_archive = False
            
            await self.run_test_batch(session, duration)
        
        self.stats.total_time = time.time() - start_time
        self.print_results()
    
    def print_results(self):
        """Print detailed test results"""
        print("\n" + "="*80)
        print("BERACHAIN RPC THROUGHPUT TEST RESULTS")
        print("="*80)
        
        # Overall statistics
        print(f"\nOVERALL STATISTICS:")
        print(f"Total RPC calls:      {self.stats.total_calls:,}")
        print(f"Successful calls:     {self.stats.successful_calls:,}")
        print(f"Failed calls:         {self.stats.failed_calls:,}")
        print(f"Success rate:         {(self.stats.successful_calls/self.stats.total_calls)*100:.2f}%")
        print(f"Total test time:      {self.stats.total_time:.2f} seconds")
        
        # Throughput metrics
        if self.stats.total_time > 0:
            overall_throughput = self.stats.total_calls / self.stats.total_time
            success_throughput = self.stats.successful_calls / self.stats.total_time
            print(f"Overall throughput:   {overall_throughput:.2f} calls/second")
            print(f"Success throughput:   {success_throughput:.2f} calls/second")
        
        # Latency statistics
        if self.stats.latencies:
            print(f"\nLATENCY STATISTICS (successful calls only):")
            print(f"Average latency:      {statistics.mean(self.stats.latencies)*1000:.2f} ms")
            print(f"Median latency:       {statistics.median(self.stats.latencies)*1000:.2f} ms")
            print(f"Min latency:          {min(self.stats.latencies)*1000:.2f} ms")
            print(f"Max latency:          {max(self.stats.latencies)*1000:.2f} ms")
            
            if len(self.stats.latencies) > 1:
                print(f"Std deviation:        {statistics.stdev(self.stats.latencies)*1000:.2f} ms")
                
                # Percentiles
                sorted_latencies = sorted(self.stats.latencies)
                p95_idx = int(0.95 * len(sorted_latencies))
                p99_idx = int(0.99 * len(sorted_latencies))
                print(f"95th percentile:      {sorted_latencies[p95_idx]*1000:.2f} ms")
                print(f"99th percentile:      {sorted_latencies[p99_idx]*1000:.2f} ms")
        
        # Call type breakdown
        print(f"\nCALL TYPE BREAKDOWN:")
        print(f"{'Call Type':<25} {'Total':<8} {'Success':<8} {'Rate':<8}")
        print("-" * 50)
        for call_type in sorted(self.stats.calls_by_type.keys()):
            total = self.stats.calls_by_type[call_type]
            success = self.stats.successful_by_type.get(call_type, 0)
            rate = (success / total * 100) if total > 0 else 0
            print(f"{call_type:<25} {total:<8} {success:<8} {rate:<6.1f}%")
        
        # Archive node statistics
        if self.test_archive and self.stats.historical_calls > 0:
            print(f"\nARCHIVE NODE STATISTICS:")
            historical_success_rate = (self.stats.historical_successful / self.stats.historical_calls * 100) if self.stats.historical_calls > 0 else 0
            print(f"Historical calls:     {self.stats.historical_calls:,}")
            print(f"Historical success:   {self.stats.historical_successful:,}")
            print(f"Historical success rate: {historical_success_rate:.2f}%")
            
            if self.stats.historical_latencies:
                print(f"Historical avg latency: {statistics.mean(self.stats.historical_latencies)*1000:.2f} ms")
                print(f"Historical median latency: {statistics.median(self.stats.historical_latencies)*1000:.2f} ms")
            
            current_calls = self.stats.total_calls - self.stats.historical_calls
            current_success = self.stats.successful_calls - self.stats.historical_successful
            if current_calls > 0:
                current_success_rate = (current_success / current_calls * 100)
                print(f"Current calls success rate: {current_success_rate:.2f}%")
        
        # Error breakdown
        if self.stats.error_types:
            print(f"\nERROR BREAKDOWN:")
            for error_type, count in sorted(self.stats.error_types.items(), key=lambda x: x[1], reverse=True):
                percentage = (count / self.stats.failed_calls * 100) if self.stats.failed_calls > 0 else 0
                print(f"{error_type:<30} {count:>6} ({percentage:>5.1f}%)")
        
        print("\n" + "="*80)

def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description="Berachain RPC Throughput Tester",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Test default mainnet RPC for 60 seconds
  python berachain-rpc-tester.py
  
  # Test custom RPC with specific duration and concurrency
  python berachain-rpc-tester.py --rpc-url https://rpc.berachain.com/ --duration 120 --concurrent 100
  
  # Quick 10-second test
  python berachain-rpc-tester.py --duration 10
        """
    )
    
    parser.add_argument(
        "--rpc-url",
        default="https://rpc.berachain.com/",
        help="Berachain RPC URL to test (default: https://rpc.berachain.com/)"
    )
    
    parser.add_argument(
        "--duration",
        type=int,
        default=60,
        help="Test duration in seconds (default: 60)"
    )
    
    parser.add_argument(
        "--concurrent",
        type=int,
        default=50,
        help="Maximum concurrent requests (default: 50)"
    )
    
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose logging"
    )
    
    parser.add_argument(
        "--archive",
        action="store_true",
        help="Enable archive node testing with historical queries"
    )
    
    parser.add_argument(
        "--archive-blocks",
        type=int,
        default=3_000_000,
        help="Number of blocks back to test for archive queries (default: 3,000,000)"
    )
    
    args = parser.parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    # Validate arguments
    if args.duration <= 0:
        print("Error: Duration must be positive")
        sys.exit(1)
    
    if args.concurrent <= 0:
        print("Error: Concurrent requests must be positive")
        sys.exit(1)
    
    # Create and run tester
    tester = BerachainRPCTester(
        args.rpc_url, 
        args.concurrent, 
        args.archive, 
        args.archive_blocks
    )
    
    try:
        asyncio.run(tester.run_test(args.duration))
    except KeyboardInterrupt:
        print("\nTest interrupted by user")
        if tester.stats.total_calls > 0:
            tester.print_results()
    except Exception as e:
        logger.error(f"Test failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
