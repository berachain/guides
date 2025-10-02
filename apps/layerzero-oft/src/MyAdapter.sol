// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OFTAdapter } from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/OFTAdapter.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract MyAdapter is OFTAdapter {
    constructor(
        address _token, // a deployed, already existing ERC20 token address
        address _lzEndpoint, // local endpoint address
        address _delegate // token owner used as a delegate in LayerZero Endpoint
    ) OFTAdapter(_token, _lzEndpoint, _delegate) Ownable(_delegate) {}
}
