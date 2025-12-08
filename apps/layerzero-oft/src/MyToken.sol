// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MyToken is ERC20, Ownable {
    constructor(string memory name, string memory symbol, uint256 initialSupply, address _owner)
        ERC20(name, symbol)
        Ownable(_owner)
    {
        _mint(_owner, initialSupply);
    }

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}
