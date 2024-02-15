// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

contract HelloWorld {
    // Event that allows for emitting a message when the greeting is changed
    event NewGreeting(address indexed sender, string message);

    // Variable to store the greeting message
    string private greeting;

    // Address of the contract owner
    address private owner;

    // Main constructor run at deployment
    constructor(string memory _greeting) {
        greeting = _greeting;
        owner = msg.sender; // Setting the contract deployer as the owner
        emit NewGreeting(msg.sender, _greeting);
    }

    // Modifier to restrict access to the owner only
    modifier onlyOwner() {
        require(msg.sender == owner, "Only the owner can change the greeting");
        _;
    }

    // Function to get the current greeting
    function getGreeting() public view returns (string memory) {
        return greeting;
    }

    // Function to set a new greeting; restricted to owner
    function setGreeting(string memory _greeting) public onlyOwner {
        greeting = _greeting;
        emit NewGreeting(msg.sender, _greeting);
    }

    // Optional: Function to transfer ownership of the contract
    function transferOwnership(address newOwner) public onlyOwner {
        require(newOwner != address(0), "New owner cannot be the zero address");
        owner = newOwner;
    }
}
