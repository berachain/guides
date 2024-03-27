// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

contract ConsumerContract {
    IPyth pyth;

    /**
     * Network: Berachain Artio (testnet)
     * Address: 0x8D254a21b3C86D32F7179855531CE99164721933
     */
    constructor() {
        pyth = IPyth(0x8D254a21b3C86D32F7179855531CE99164721933);
    }

    function getPrice() public view returns (PythStructs.Price memory) {
        // ETH/USD priceID
        bytes32 priceID = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;
        return pyth.getPrice(priceID);
    }

    function updatePrice(bytes[] calldata priceUpdateData) public payable {
        uint fee = pyth.getUpdateFee(priceUpdateData);
        pyth.updatePriceFeeds{value: fee}(priceUpdateData);
    }

    function getLatestPrice(
        bytes[] calldata priceUpdateData
    ) external payable returns (PythStructs.Price memory) {
        updatePrice(priceUpdateData);
        return getPrice();
    }
}
