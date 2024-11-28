// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Faucet {

    mapping(address => uint256) public sendRecords;
    uint256 public sendQuantity;
    address public owner;

    constructor(uint256 _sendQuantity) {
        sendQuantity = _sendQuantity;
        owner = msg.sender;
    }

    // receive donate event
    event ReceiveDonateEvent(address indexed from, uint256 amount);

    receive() external payable {
        onReceiveDonate();
    }

    // receive users donate
    function donate() external payable {
        onReceiveDonate();
    }

    function request() external {
        if (sendRecords[msg.sender] > 0) {
            require(block.timestamp - sendRecords[msg.sender] >= 1 days, "You can only request tokens once every 24 hours");
        }

        require(address(this).balance >= sendQuantity, "Insufficient balance in Faucet");
        
        sendRecords[msg.sender] = block.timestamp; // update receive record
        payable(msg.sender).transfer(sendQuantity); // transfer
    }

    function withdraw() external {
        require(msg.sender == owner, "Only the contract owner can withdraw");
        payable(owner).transfer(address(this).balance);
    }

    function airdrop(address to, uint256 amount) external {
        require(address(this).balance >= amount, "Insufficient balance in Faucet");

        sendRecords[to] = block.timestamp; // update receive record
        payable(to).transfer(amount); // transfer
    }

    // get faucet balance
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function setSendQuantity(uint256 _sendQuantity) public {
        require(msg.sender == owner, "Only the owner can set the quantity");
        sendQuantity = _sendQuantity;
    }

    function onReceiveDonate() private {
        require(msg.value > 0, "donate amount must be greater than 0");

        // send donate event
        emit ReceiveDonateEvent(msg.sender, msg.value);
    }

}