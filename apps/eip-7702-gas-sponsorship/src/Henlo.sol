// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

interface IHenlo {
    function sayHenlo() external payable;
}

/// @title Henlo Educational Contract
/// @notice A simple "Henlo" contract used for educational purposes with EIP-7702 Guides
contract Henlo is IHenlo {
    event HenloSaid(address indexed sender, string message);

    function  sayHenlo() external payable override {
        emit HenloSaid(msg.sender, "Henlo Ooga Booga");
    }
}

