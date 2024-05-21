// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@pythnetwork/entropy-sdk-solidity/IEntropy.sol";
import "@pythnetwork/entropy-sdk-solidity/IEntropyConsumer.sol";

contract EntropyNFT is ERC721Enumerable, IEntropyConsumer {
    event NumberRequested(uint64 sequenceNumber, address minter);
    event Minted(uint64 sequenceNumber, address minter, uint256 tokenId);

    IEntropy entropy;
    address provider;
    uint256 public constant MAX_SUPPLY = 500;
    uint256 public nextIndex;
    uint256[] private availableTokenIds;

    // Mapping of sequence numbers to minter addresses
    mapping(uint64 => address) public sequenceNumberToMinter;

    constructor(
        address _entropy,
        address _provider
    ) ERC721("EntropyNFT", "eNFT") {
        entropy = IEntropy(_entropy);
        provider = _provider;
        initializeAvailableTokenIds();
    }

    // Step 1 of 2: Request a new random number for minting
    // Returns sequence number used to obtain random number from Pyth
    function requestMint(bytes32 userRandomNumber) external payable {
        require(nextIndex < MAX_SUPPLY, "Reached max supply");

        uint128 requestFee = entropy.getFee(provider);
        require(msg.value >= requestFee, "not enough fees");

        uint64 sequenceNumber = entropy.requestWithCallback{value: requestFee}(
            provider,
            userRandomNumber
        );

        sequenceNumberToMinter[sequenceNumber] = msg.sender;

        emit NumberRequested(sequenceNumber, msg.sender);
    }

    // Step 2 of 2: Fulfill mint request on Pyth callback
    function entropyCallback(
        uint64 sequenceNumber,
        address,
        bytes32 randomNumber
    ) internal override {
        address minter = sequenceNumberToMinter[sequenceNumber];
        uint256 randomIndex = uint256(randomNumber) % availableTokenIds.length;
        uint256 tokenId = availableTokenIds[randomIndex];

        // Swap-and-pop to replace minted tokenId
        availableTokenIds[randomIndex] = availableTokenIds[
            availableTokenIds.length - 1
        ];
        availableTokenIds.pop();
        nextIndex++;

        _safeMint(minter, tokenId);
        emit Minted(sequenceNumber, minter, tokenId);
    }

    // Initialize array of available token IDs
    function initializeAvailableTokenIds() private {
        for (uint256 i = 0; i < MAX_SUPPLY; i++) {
            availableTokenIds.push(i);
        }
    }

    // This method is required by the IEntropyConsumer interface
    function getEntropy() internal view override returns (address) {
        return address(entropy);
    }

    receive() external payable {}
}
