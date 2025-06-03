// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/BlockHashTracker.sol";

contract BlockHashDemoScript is Script {
    function run() external {
        vm.startBroadcast();

        BlockHashTracker tracker = new BlockHashTracker();
        BlockHashCheckerEIP2935 checker = new BlockHashCheckerEIP2935();

        console.log("BlockHashTracker:      ", address(tracker));
        console.log("BlockHashCheckerEIP2935:", address(checker));

        // Write to .env
        string memory path = ".env";
        vm.writeLine(path, string.concat("TRACKER=", vm.toString(address(tracker))));
        vm.writeLine(path, string.concat("CHECKER=", vm.toString(address(checker))));

        vm.stopBroadcast();

        // Show gas estimates
        uint256 blockToTest = block.number - 10; // Should still be within 256
        bytes memory storeCall = abi.encodeCall(tracker.storeBlockHash, (blockToTest));
        bytes memory lookupCall = abi.encodeCall(checker.getOldHash, (blockToTest));

        uint256 storeGas = vm.estimateGas(address(tracker), storeCall);
        uint256 lookupGas = vm.estimateGas(address(checker), lookupCall);

        console.log("Gas to store hash manually (legacy):     ", storeGas);
        console.log("Gas to read hash via EIP-2935 opcode:   ", lookupGas);
    }
}
