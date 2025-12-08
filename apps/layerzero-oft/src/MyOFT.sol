// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {OFT} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/OFT.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MyOFT is OFT {
    constructor(string memory _name, string memory _symbol, address _lzEndpoint, address _delegate)
        OFT(_name, _symbol, _lzEndpoint, _delegate)
        Ownable(_delegate)
    {}
}
