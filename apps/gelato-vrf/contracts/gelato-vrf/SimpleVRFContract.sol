// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.18;

import {GelatoVRFConsumerBase} from "./GelatoVRFConsumerBase.sol";

contract SimpleVRFContract is GelatoVRFConsumerBase {
    address private immutable _operatorAddr; //
    bytes32 public latestRandomness;
    uint64 public lastRequestId;

    struct Request {
        uint256 requestTime;
        uint256 requestBlock;
        uint256 fulfilledTime;
        uint256 fulfilledBlock;
        uint256 randomness;
    }

    event RandomnessRequested(uint64 requestId);
    event RandomnessFulfilled(uint256 indexed nonce, Request);

    mapping(uint256 => Request) public requests;
    uint256 public nonce;

    constructor(address dedicatedMsgSender) {
        _operatorAddr = dedicatedMsgSender;
    }

    function requestRandomness(bytes memory _data) external {
        // Add your own access control mechanism here
        lastRequestId = uint64(_requestRandomness(_data));
        emit RandomnessRequested(lastRequestId);
    }

    function _fulfillRandomness(uint256 _randomness, uint256 _requestId, bytes memory _data) internal override {
        // Ensure that this is the expected request being fulfilled
        require(lastRequestId == _requestId, "Request ID does not match the last request.");

        // Create the request record in storage
        Request storage request = requests[uint64(_requestId)];
        request.requestTime = block.timestamp;
        request.requestBlock = block.number;
        request.fulfilledTime = block.timestamp;
        request.fulfilledBlock = block.number;
        request.randomness = _randomness;

        // Update the latest randomness and lastRequestId state variables
        latestRandomness = bytes32(_randomness); // Keep if you need bytes32, otherwise just use _randomness
        lastRequestId = uint64(_requestId);

        // Emit an event to signal that the randomness has been fulfilled
        emit RandomnessFulfilled(uint64(_requestId), request);
    }

    // Implement the _operator() function to return the operator's address
    function _operator() internal view virtual override returns (address) {
        return _operatorAddr;
    }
}