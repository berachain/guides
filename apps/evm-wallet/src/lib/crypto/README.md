# `src/lib/crypto/`

Reserved for JS-side wrappers around the native `wallet-crypto` Expo module.

As of Stage 6, BIP39 mnemonic generation and storage live in Swift
(`modules/wallet-crypto/ios/`). Future stages — BIP32 derivation, secp256k1
signing, address formatting — will add thin TypeScript wrappers in this
directory that call into the native module rather than implementing crypto
in JS.

Do not add pure-TS crypto here without talking to the team first.
