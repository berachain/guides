// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {MyToken} from "../src/MyToken.sol";

// Deploy custom ERC20 token to Base Mainnet
contract MyTokenScript is Script {
    function run() public {
        // Setup
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);

        // Deploy token with initial supply of 1,000,000 tokens
        MyToken token = new MyToken(
            "My Custom Token",
            "MCT",
            1000000 * 10**18, // 1M tokens with 18 decimals
            vm.addr(privateKey) // Owner address
        );

        console.log("Token deployed at:", address(token));
        console.log("Token name:", token.name());
        console.log("Token symbol:", token.symbol());
        console.log("Total supply:", token.totalSupply());

        vm.stopBroadcast();
    }
}
