// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "solmate/tokens/ERC20.sol";

contract UrsaToken is ERC20 {
    constructor() ERC20("Ursa Token", "URSA", 18) {
        _mint(msg.sender, 1000000 * 10**18); // Mint 1 million tokens
    }
} 