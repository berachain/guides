# Stage 7 Test Vectors

## BIP39 Mnemonic To Seed

These are official BIP39 vectors using passphrase `TREZOR`.

| Mnemonic                                                                                        | Seed hex                                                                                                                           |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about` | `c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04` |
| `legal winner thank year wave sausage worth useful legal winner thank yellow`                   | `2e8905819b8723fe2c1d161860e5ee1830318dbf49a83bd451cfb8440c28bd6fa457fe1296106559a3c80937a1c1069be3a3a5bd381ee6260e8d9739fce1f607` |
| `letter advice cage absurd amount doctor acoustic avoid letter advice cage above`               | `d71de856f81a8acc65e6fc851a38d4d7ec216fd0796d0a6827a3ad6ed5511a30fa280f12eb2e47ed2ac03b5c462a0358d18d69fe4f985ec81778c1b370b652a8` |

## EVM Primary Address

Path: `m/44'/60'/0'/0/0`

| Mnemonic                                                                                        | Passphrase | Expected address                             |
| ----------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------- |
| `abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about` | empty      | `0x9858EfFD232B4033E47d90003D41EC34EcaEda94` |

The address above was cross-checked against the common ethers/MetaMask derivation
for the same mnemonic and path.

## EIP-55 Checksum Examples

Canonical EIP-55 mixed-case examples:

- `0x52908400098527886E0F7030069857D2E4169EE7`
- `0x8617E340B3D01FA5F11F306F4090FD50E238070D`
- `0xde709f2102306220921060314715629080e2fb77`
- `0x27b1fdb04752bbc536007a920d24acb045561c26`
- `0x5AEDA56215b167893e80B4fE645BA6d5Bab767DE`
