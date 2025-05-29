// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ERC20} from "lib/solmate/src/tokens/ERC20.sol";

contract UrsaToken is ERC20 {
    address public owner;

    constructor() ERC20("Ursa Token", "URSA", 18) {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
} 