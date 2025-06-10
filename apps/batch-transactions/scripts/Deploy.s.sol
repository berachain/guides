// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../src/BatchTransaction.sol";

contract DeployScript is Script {
    function run() public returns (BatchTransaction) {
        // Get the private key from environment
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        // Start broadcasting transactions
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy the contract
        BatchTransaction batchTx = new BatchTransaction();
        
        // Stop broadcasting
        vm.stopBroadcast();

        // Log the deployed address
        console2.log("BatchTransaction deployed to:", address(batchTx));

        return batchTx;
    }
} 