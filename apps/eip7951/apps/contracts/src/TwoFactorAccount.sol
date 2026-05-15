// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract TwoFactorAccount {
    address public constant P256VERIFY = address(0x100);

    uint256 constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    address public owner;
    uint256 public p256PublicKeyX;
    uint256 public p256PublicKeyY;
    uint256 public nonce;

    constructor(
        address _owner,
        uint256 _p256x,
        uint256 _p256y
    ) {
        owner = _owner;
        p256PublicKeyX = _p256x;
        p256PublicKeyY = _p256y;
    }

    function execute(
        address target,
        uint256 value,
        bytes calldata data,
        uint8 v,
        bytes32 r,
        bytes32 s,
        bytes calldata authenticatorData,
        bytes calldata clientDataJSON,
        bytes32 p256R,
        bytes32 p256S
    ) external {
        bytes32 intentHash = keccak256(
            abi.encodePacked(target, value, data, nonce, block.chainid)
        );

        bytes32 ethHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", intentHash)
        );

        // Signature malleability: enforce canonical low-s for EOA sig
        require(uint256(s) <= SECP256K1_N / 2, "Non-canonical s");

        address recovered = ecrecover(ethHash, v, r, s);
        require(recovered == owner, "Invalid owner signature");

        bytes memory challenge = _base64UrlEncode(intentHash);
        require(
            _contains(clientDataJSON, abi.encodePacked('"type":"webauthn.get"')),
            "Invalid WebAuthn type"
        );
        require(
            _contains(clientDataJSON, abi.encodePacked('"challenge":"', challenge, '"')),
            "Invalid WebAuthn challenge"
        );

        bytes32 webAuthnHash = sha256(
            abi.encodePacked(authenticatorData, sha256(clientDataJSON))
        );

        // WebAuthn signs sha256(authenticatorData || sha256(clientDataJSON)).
        bytes memory p256Input = abi.encodePacked(
            webAuthnHash,
            p256R,
            p256S,
            p256PublicKeyX,
            p256PublicKeyY
        );
        (bool success, bytes memory result) = P256VERIFY.staticcall(p256Input);
        require(
            success && result.length == 32 && uint256(bytes32(result)) == 1,
            "Invalid P-256 signature"
        );

        nonce++;
        (bool executed,) = target.call{value: value}(data);
        require(executed, "Execution failed");
    }

    receive() external payable {}

    function _contains(bytes calldata haystack, bytes memory needle) private pure returns (bool) {
        if (needle.length == 0 || needle.length > haystack.length) {
            return false;
        }

        for (uint256 i = 0; i <= haystack.length - needle.length; i++) {
            bool found = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    found = false;
                    break;
                }
            }
            if (found) {
                return true;
            }
        }

        return false;
    }

    function _base64UrlEncode(bytes32 value) private pure returns (bytes memory) {
        bytes memory alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        bytes memory input = abi.encodePacked(value);
        bytes memory output = new bytes(43);
        uint256 outputIndex;

        for (uint256 i = 0; i < input.length; i += 3) {
            uint256 a = uint8(input[i]);
            uint256 b = i + 1 < input.length ? uint8(input[i + 1]) : 0;
            uint256 c = i + 2 < input.length ? uint8(input[i + 2]) : 0;
            uint256 triple = (a << 16) | (b << 8) | c;

            output[outputIndex++] = alphabet[(triple >> 18) & 0x3F];
            output[outputIndex++] = alphabet[(triple >> 12) & 0x3F];
            if (outputIndex < output.length) {
                output[outputIndex++] = alphabet[(triple >> 6) & 0x3F];
            }
            if (outputIndex < output.length) {
                output[outputIndex++] = alphabet[triple & 0x3F];
            }
        }

        return output;
    }
}
