// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract BingBongToken is ERC20 {
    /**
     * @dev Init constructor for setting token name and symbol
     */
    constructor(string memory name_, string memory symbol_, uint256 mintedTokens_) ERC20(name_, symbol_) {
        _mint(msg.sender, mintedTokens_);
    }
} 