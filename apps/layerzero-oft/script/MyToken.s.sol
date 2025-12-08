// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {MyToken} from "../src/MyToken.sol";

// Deploy custom ERC20 token to Base Mainnet
contract MyTokenScript is Script {
    function run() public {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);

        MyToken token = new MyToken("My Custom Token", "MCT", 1000000 * 10 ** 18, vm.addr(privateKey));

        console.log("Token deployed:", address(token));
        console.log("Name:", token.name());
        console.log("Symbol:", token.symbol());
        console.log("Total supply:", token.totalSupply());

        vm.stopBroadcast();
    }
}
