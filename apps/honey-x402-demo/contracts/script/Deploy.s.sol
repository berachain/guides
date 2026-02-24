// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Honey} from "../src/Honey.sol";
import {Demo} from "../src/Demo.sol";
import {Permit2} from "../src/Permit2/Permit2.sol";

contract DeployScript is Script {
    // Anvil default accounts
    address constant DEPLOYER = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    address constant TOKEN_HOLDER = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address constant GAS_PAYER = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    // Anvil default private keys (used for setup transactions)
    uint256 constant DEPLOYER_PK_DEFAULT  = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant TOKEN_HOLDER_PK      = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 constant GAS_PAYER_PK         = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;

    function run() external {
        // Try DEPLOYER_PRIVATE_KEY first, then fall back to Anvil default.
        uint256 deployerPrivateKey;
        try vm.envUint("DEPLOYER_PRIVATE_KEY") returns (uint256 key) {
            deployerPrivateKey = key;
        } catch {
            deployerPrivateKey = DEPLOYER_PK_DEFAULT;
            console.log("Note: DEPLOYER_PRIVATE_KEY not found in .env, using Anvil default");
        }

        if (deployerPrivateKey == 0) {
            deployerPrivateKey = DEPLOYER_PK_DEFAULT;
        }

        vm.startBroadcast(deployerPrivateKey);

        console.log("Deployer:", vm.addr(deployerPrivateKey));
        console.log("Token Holder:", TOKEN_HOLDER);
        console.log("Gas Payer:", GAS_PAYER);

        // ── 1. Deploy Permit2 ──────────────────────────────────
        console.log("Deploying Permit2...");
        Permit2 permit2 = new Permit2();
        address permit2Address = address(permit2);
        console.log("Permit2 deployed at:", permit2Address);

        // ── 2. Deploy Honey token ──────────────────────────────
        console.log("Deploying Honey token...");
        Honey honey = new Honey("Honey Token", "HONEY");
        console.log("Honey deployed at:", address(honey));

        // ── 3. Deploy Demo contract ────────────────────────────
        console.log("Deploying Demo contract...");
        Demo demo = new Demo(address(honey), permit2Address);
        console.log("Demo deployed at:", address(demo));

        // ── 4. Transfer tokens to token holder ────────────────
        uint256 mintAmount = 1000 * 10 ** 18;
        honey.transfer(TOKEN_HOLDER, mintAmount);
        console.log("Transferred", mintAmount, "HONEY to token holder");

        console.log("Gas payer balance:", GAS_PAYER.balance);

        vm.stopBroadcast();

        // ── 5. Approve Permit2 for all accounts that may hold tokens ──
        // Permit2 needs a standard ERC20 approve() before it can transferFrom().
        // We approve from both the deployer (who holds the initial supply) and
        // the token holder (who receives minted tokens) so the demo works
        // regardless of which account .env maps to PRIVATE_KEY.
        vm.startBroadcast(deployerPrivateKey);
        honey.approve(permit2Address, type(uint256).max);
        console.log("Deployer approved Permit2 for max HONEY");
        vm.stopBroadcast();

        vm.startBroadcast(TOKEN_HOLDER_PK);
        honey.approve(permit2Address, type(uint256).max);
        console.log("Token holder approved Permit2 for max HONEY");
        vm.stopBroadcast();

        // ── 6. Write deployment info to JSON ──────────────────
        string memory json = string(
            abi.encodePacked(
                '{\n',
                '  "chainId": 31337,\n',
                '  "rpcUrl": "http://localhost:8545",\n',
                '  "honey": "', vm.toString(address(honey)), '",\n',
                '  "demo": "', vm.toString(address(demo)), '",\n',
                '  "permit2": "', vm.toString(permit2Address), '",\n',
                '  "tokenHolder": "', vm.toString(TOKEN_HOLDER), '",\n',
                '  "gasPayer": "', vm.toString(GAS_PAYER), '",\n',
                '  "deployer": "', vm.toString(vm.addr(deployerPrivateKey)), '"\n',
                '}'
            )
        );

        vm.writeFile("./deployments.json", json);
        console.log("\nDeployment addresses written to deployments.json");
    }
}
