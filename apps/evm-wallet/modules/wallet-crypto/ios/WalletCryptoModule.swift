import ExpoModulesCore
import Foundation

/// Expo module exposing the wallet crypto primitives to JavaScript.
///
/// Security boundary: `revealMnemonic` returns plaintext words for display.
/// Stage 7 also returns temporary BIP39 seed hex for address derivation. Both
/// values are mnemonic-equivalent secrets and must never be persisted or logged
/// by callers.
///
/// Stage 6b storage model — dual-mode, branching on `icloudBackedUp`:
///
///   - `icloudBackedUp == false` (local / SE path):
///       wallet.se.<id>        Secure Enclave P-256 private key (non-exportable)
///       wallet.aeskey.<id>    SE-wrapped AES-256 key blob (ECIES ciphertext)
///       wallet.mnemonic.<id>  AES-256-GCM ciphertext of the mnemonic
///     Reveal requires a biometric prompt (iOS gates the SE private key
///     operation that unwraps the AES key).
///
///   - `icloudBackedUp == true` (iCloud path):
///       wallet.mnemonic.<id>  UTF-8 plaintext of the mnemonic, with
///                             kSecAttrSynchronizable = true
///     Reveal does NOT prompt for biometrics. Accepted MVP limitation —
///     Stage 4b will add a passphrase-derived KEK for the iCloud path.
///
/// Existing Stage 6 wallets (plaintext, local-only) are handled
/// transparently: `revealMnemonic` checks for `wallet.aeskey.<id>` and
/// falls back to the plaintext path when it is absent.
///
/// Simulator builds are a development exception. iOS Simulator cannot
/// reliably perform Secure Enclave operations gated by
/// DeviceOwnerAuthentication, so public module functions route local wallets
/// through the plaintext Keychain path under `#if targetEnvironment(simulator)`.
/// Device builds keep the Stage 6b SE-wrapped behavior unchanged.
public class WalletCryptoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WalletCrypto")

    Function("isRunningOnSimulator") { () -> Bool in
      #if targetEnvironment(simulator)
      return true
      #else
      return false
      #endif
    }

    // MARK: - generateAndStoreMnemonic
    //
    // Generates 256 bits of entropy in Swift, converts to 24 BIP39 words,
    // writes to the Keychain, and returns the new wallet id. The plaintext
    // mnemonic never crosses the bridge here — callers who need to display
    // it must subsequently call `revealMnemonic(id)`.
    AsyncFunction("generateAndStoreMnemonic") { (icloudBackedUp: Bool) throws -> String in
      let id = UUID().uuidString

      let generated: GeneratedMnemonic
      do {
        generated = try BIP39.generateMnemonic(entropyBits: 256)
      } catch {
        throw Exception(
          name: "E_GENERATION_FAILED",
          description: "Failed to generate mnemonic: \(error)"
        )
      }
      defer { generated.cleanup() }

      let mnemonicString = BIP39.mnemonicToString(generated.words)
      guard var mnemonicData = mnemonicString.data(using: .utf8) else {
        throw Exception(
          name: "E_GENERATION_FAILED",
          description: "Failed to encode mnemonic"
        )
      }
      defer { BIP39.zero(&mnemonicData) }

      #if targetEnvironment(simulator)
      do {
        try KeychainBridge.storeMnemonicPlaintext(
          id: id,
          mnemonic: mnemonicData,
          icloudBackedUp: icloudBackedUp
        )
      } catch {
        throw Exception(
          name: "E_KEYCHAIN_WRITE_FAILED",
          description: "Failed to write simulator plaintext mnemonic to Keychain: \(error)"
        )
      }
      #else
      if icloudBackedUp {
        do {
          try KeychainBridge.storeMnemonicPlaintext(
            id: id,
            mnemonic: mnemonicData,
            icloudBackedUp: true
          )
        } catch {
          throw Exception(
            name: "E_KEYCHAIN_WRITE_FAILED",
            description: "Failed to write mnemonic to Keychain: \(error)"
          )
        }
      } else {
        try MnemonicStorage.writeSEWrapped(
          id: id,
          mnemonicData: mnemonicData
        )
      }
      #endif

      return id
    }

    // MARK: - revealMnemonic
    //
    // Branches on the presence of a wrapped AES key:
    //   - SE path: unwrap AES (biometric prompt), decrypt mnemonic, return.
    //   - Plaintext path: read UTF-8, return. No biometric prompt. Applies
    //     to iCloud-backed wallets and to Stage 6 (pre-6b) local wallets.
    //
    // The asymmetry is deliberate: iCloud requires the stored item to be
    // usable from a fresh device, which precludes SE wrapping. Stage 4b
    // will close this gap with a user passphrase.
    AsyncFunction("revealMnemonic") {
      (id: String, prompt: String?) throws -> String in
      #if targetEnvironment(simulator)
      return try MnemonicStorage.revealPlaintext(id: id)
      #else
      let effectivePrompt = prompt ?? "Authenticate to view your recovery phrase"
      // Path selection: the presence of a wrapped AES key is the
      // authoritative signal for the SE-wrapped path. We probe via
      // existence rather than reading the blob so we do not touch the
      // Keychain unnecessarily.
      let hasWrappedAES: Bool
      do {
        hasWrappedAES = try KeychainBridge.wrappedAESKeyExists(id: id)
      } catch {
        throw Exception(
          name: "E_KEYCHAIN_READ_FAILED",
          description: "Failed to probe wrapped AES key: \(error)"
        )
      }

      if hasWrappedAES {
        return try MnemonicStorage.revealSEWrapped(id: id, prompt: effectivePrompt)
      }
      return try MnemonicStorage.revealPlaintext(id: id)
      #endif
    }

    // MARK: - deleteMnemonic
    //
    // Best-effort cleanup across all four potential artifacts for `id`:
    //   wallet.se.<id>      (SE private key)
    //   wallet.aeskey.<id>  (wrapped AES key)
    //   wallet.mnemonic.<id> (plaintext OR ciphertext)
    //
    // `try?` on each is appropriate — we do not want a single missing
    // artifact (normal for wallets that never had an SE path, or for
    // retry-after-partial-rollback) to fail the whole delete.
    AsyncFunction("deleteMnemonic") { (id: String) throws in
      try? SecureEnclaveKey.delete(id: id)
      try? KeychainBridge.deleteWrappedAESKey(id: id)
      try? KeychainBridge.deleteMnemonicCiphertext(id: id)
      // The ciphertext and plaintext items share the same service name, so
      // the call above already removes the plaintext variant. We keep the
      // second call for clarity and defense-in-depth against future
      // divergence of the two service names.
      try? KeychainBridge.deleteMnemonicPlaintext(id: id)
    }

    // MARK: - mnemonicExists
    //
    // Returns true if either the mnemonic blob exists (plaintext or
    // ciphertext — both share a service name) OR a wrapped AES key is
    // present. We intentionally do NOT return true based only on the SE
    // key: an SE key with no wrapped AES is an orphan that `deleteMnemonic`
    // will clean up.
    AsyncFunction("mnemonicExists") { (id: String) throws -> Bool in
      do {
        if try KeychainBridge.mnemonicExists(id: id) { return true }
        return try KeychainBridge.wrappedAESKeyExists(id: id)
      } catch {
        throw Exception(
          name: "E_KEYCHAIN_READ_FAILED",
          description: "Failed to check Keychain: \(error)"
        )
      }
    }

    // MARK: - setMnemonicSyncState
    //
    // Migrates a wallet between the local (SE-wrapped) and iCloud
    // (plaintext-synced) storage modes. Same mode → no-op. Different
    // mode → decrypt + re-encrypt under the new mode, with full cleanup
    // of the old-mode artifacts.
    //
    // This is the one code path in Stage 6b where the plaintext mnemonic
    // touches Swift memory outside of `revealMnemonic`. The transient
    // `Data` buffers are wrapped in `defer memset_s` blocks.
    AsyncFunction("setMnemonicSyncState") {
      (id: String, icloudBackedUp: Bool, prompt: String?) throws in
      #if targetEnvironment(simulator)
      do {
        try KeychainBridge.setSyncState(id: id, icloudBackedUp: icloudBackedUp)
      } catch KeychainError.unexpectedStatus(let status) where status == errSecItemNotFound {
        throw Exception(
          name: "E_NOT_FOUND",
          description: "No mnemonic stored for id \(id)"
        )
      } catch {
        throw Exception(
          name: "E_KEYCHAIN_WRITE_FAILED",
          description: "Failed to update simulator plaintext mnemonic sync state: \(error)"
        )
      }
      return
      #else
      let effectivePrompt = prompt ?? "Authenticate to update iCloud backup state"
      let hasWrappedAES: Bool
      do {
        hasWrappedAES = try KeychainBridge.wrappedAESKeyExists(id: id)
      } catch {
        throw Exception(
          name: "E_KEYCHAIN_READ_FAILED",
          description: "Failed to probe wrapped AES key: \(error)"
        )
      }
      let hasMnemonicItem: Bool
      do {
        hasMnemonicItem = try KeychainBridge.mnemonicExists(id: id)
      } catch {
        throw Exception(
          name: "E_KEYCHAIN_READ_FAILED",
          description: "Failed to probe mnemonic item: \(error)"
        )
      }
      if !hasMnemonicItem && !hasWrappedAES {
        throw Exception(
          name: "E_NOT_FOUND",
          description: "No mnemonic stored for id \(id)"
        )
      }

      let currentlyIcloud = !hasWrappedAES  // plaintext ⇒ iCloud (Stage 6b) or legacy local
      if currentlyIcloud == icloudBackedUp {
        // No transition. If the item is on the plaintext path and still
        // needs its synchronizable bit flipped (pre-Stage-6b local → later
        // iCloud toggle), reuse the direct Keychain-level migration.
        if !hasWrappedAES {
          do {
            try KeychainBridge.setSyncState(id: id, icloudBackedUp: icloudBackedUp)
          } catch KeychainError.unexpectedStatus(let status) where status == errSecItemNotFound {
            throw Exception(
              name: "E_NOT_FOUND",
              description: "No mnemonic stored for id \(id)"
            )
          } catch {
            throw Exception(
              name: "E_KEYCHAIN_WRITE_FAILED",
              description: "Failed to update mnemonic sync state: \(error)"
            )
          }
        }
        return
      }

      if icloudBackedUp {
        // Local (SE-wrapped) → iCloud (plaintext).
        try MnemonicStorage.migrateLocalToICloud(id: id, prompt: effectivePrompt)
      } else {
        // iCloud (plaintext) → local (SE-wrapped).
        try MnemonicStorage.migrateICloudToLocal(id: id)
      }
      #endif
    }

    // MARK: - deriveSeedFromMnemonic
    //
    // Returns the 64-byte BIP39 seed as a lowercase hex string. The seed is
    // equivalent in security terms to the mnemonic itself: callers must derive
    // the needed public address, drop the string reference immediately, and
    // never persist or log this value.
    AsyncFunction("deriveSeedFromMnemonic") {
      (id: String, prompt: String) throws -> String in
      return try MnemonicStorage.deriveSeedHex(id: id, prompt: prompt)
    }

    // MARK: - setSyncStateAndDeriveSeed
    //
    // Combines sync-state migration and seed derivation so the common
    // local→iCloud create flow unwraps the Secure Enclave key only once.
    AsyncFunction("setSyncStateAndDeriveSeed") {
      (id: String, icloudBackedUp: Bool, prompt: String) throws -> String in
      return try MnemonicStorage.setSyncStateAndDeriveSeedHex(
        id: id,
        icloudBackedUp: icloudBackedUp,
        prompt: prompt
      )
    }
  }
}

// MARK: - MnemonicStorage helpers

/// Helpers shared across the `WalletCryptoModule` `AsyncFunction` closures.
/// Kept outside the class to avoid `self`-capture semantics inside the
/// Expo `Module` DSL closures.
enum MnemonicStorage {

  /// Encrypt the mnemonic with a fresh AES key, wrap that AES key with the
  /// Secure Enclave public key, and write both blobs to the Keychain.
  /// Best-effort rollback on any intermediate failure.
  static func writeSEWrapped(id: String, mnemonicData: Data) throws {
    var aesKey: Data
    do {
      aesKey = try AESEncryption.randomKey()
    } catch {
      throw Exception(
        name: "E_CRYPTO_FAILED",
        description: "Failed to generate AES key: \(error)"
      )
    }
    defer { BIP39.zero(&aesKey) }

    var ciphertext: Data
    do {
      ciphertext = try AESEncryption.encrypt(plaintext: mnemonicData, key: aesKey)
    } catch {
      throw Exception(
        name: "E_CRYPTO_FAILED",
        description: "Failed to encrypt mnemonic: \(error)"
      )
    }
    defer { BIP39.zero(&ciphertext) }

    do {
      _ = try SecureEnclaveKey.create(id: id)
    } catch {
      throw Exception(
        name: "E_SE_KEY_FAILED",
        description: "Failed to create Secure Enclave key: \(error)"
      )
    }

    let wrapped: Data
    do {
      wrapped = try SecureEnclaveKey.wrapAESKey(aesKey, id: id)
    } catch {
      // Rollback the SE key we just created so we don't leak an orphan.
      try? SecureEnclaveKey.delete(id: id)
      throw Exception(
        name: "E_SE_WRAP_FAILED",
        description: "Failed to wrap AES key with Secure Enclave: \(error)"
      )
    }

    do {
      try KeychainBridge.storeWrappedAESKey(id: id, wrapped: wrapped, icloudBackedUp: false)
    } catch {
      try? SecureEnclaveKey.delete(id: id)
      throw Exception(
        name: "E_KEYCHAIN_WRITE_FAILED",
        description: "Failed to write wrapped AES key: \(error)"
      )
    }

    do {
      try KeychainBridge.storeMnemonicCiphertext(id: id, ciphertext: ciphertext)
    } catch {
      try? KeychainBridge.deleteWrappedAESKey(id: id)
      try? SecureEnclaveKey.delete(id: id)
      throw Exception(
        name: "E_KEYCHAIN_WRITE_FAILED",
        description: "Failed to write mnemonic ciphertext: \(error)"
      )
    }
  }

  /// SE-wrapped reveal. Triggers the biometric prompt on unwrap.
  static func revealSEWrapped(id: String, prompt: String) throws -> String {
    let wrapped: Data
    do {
      guard let found = try KeychainBridge.readWrappedAESKey(id: id) else {
        throw Exception(
          name: "E_CORRUPT_STATE",
          description: "Wrapped AES key disappeared between probe and read for \(id)"
        )
      }
      wrapped = found
    } catch {
      throw Exception(
        name: "E_KEYCHAIN_READ_FAILED",
        description: "Failed to read wrapped AES key: \(error)"
      )
    }

    var aesKey: Data
    do {
      aesKey = try SecureEnclaveKey.unwrapAESKey(
        wrappedBlob: wrapped,
        id: id,
        prompt: prompt
      )
    } catch SecureEnclaveError.userCanceled {
      throw Exception(
        name: "E_USER_CANCELED",
        description: "Biometric prompt was canceled by the user"
      )
    } catch SecureEnclaveError.keyNotFound {
      throw Exception(
        name: "E_CORRUPT_STATE",
        description: "Wrapped AES key is present but SE private key is missing for \(id)"
      )
    } catch {
      throw Exception(
        name: "E_SE_UNWRAP_FAILED",
        description: "Failed to unwrap AES key: \(error)"
      )
    }
    defer { BIP39.zero(&aesKey) }

    let ciphertext: Data
    do {
      guard let found = try KeychainBridge.readMnemonicCiphertext(id: id) else {
        throw Exception(
          name: "E_CORRUPT_STATE",
          description: "Wrapped AES key exists but mnemonic ciphertext is missing for \(id)"
        )
      }
      ciphertext = found
    } catch {
      throw Exception(
        name: "E_KEYCHAIN_READ_FAILED",
        description: "Failed to read mnemonic ciphertext: \(error)"
      )
    }

    var mnemonicData: Data
    do {
      mnemonicData = try AESEncryption.decrypt(ciphertext: ciphertext, key: aesKey)
    } catch {
      throw Exception(
        name: "E_CRYPTO_FAILED",
        description: "Failed to decrypt mnemonic: \(error)"
      )
    }
    defer { BIP39.zero(&mnemonicData) }

    guard let mnemonic = String(data: mnemonicData, encoding: .utf8) else {
      throw Exception(
        name: "E_CRYPTO_FAILED",
        description: "Decrypted mnemonic was not valid UTF-8"
      )
    }
    return mnemonic
  }

  /// Plaintext reveal (iCloud path and pre-Stage-6b local wallets). No
  /// biometric prompt — this is the Stage 6 behavior preserved verbatim.
  static func revealPlaintext(id: String) throws -> String {
    let data: Data?
    do {
      data = try KeychainBridge.readMnemonicPlaintext(id: id)
    } catch {
      throw Exception(
        name: "E_KEYCHAIN_READ_FAILED",
        description: "Failed to read mnemonic from Keychain: \(error)"
      )
    }
    guard let found = data else {
      throw Exception(
        name: "E_NOT_FOUND",
        description: "No mnemonic stored for id \(id)"
      )
    }
    guard let mnemonic = String(data: found, encoding: .utf8) else {
      throw Exception(
        name: "E_CORRUPT_STATE",
        description: "Stored mnemonic was not valid UTF-8"
      )
    }
    return mnemonic
  }

  // MARK: - Seed derivation

  static func deriveSeedHex(id: String, prompt: String) throws -> String {
    var mnemonicData = try readMnemonicData(id: id, prompt: prompt)
    defer { BIP39.zero(&mnemonicData) }
    return try seedHex(from: mnemonicData)
  }

  static func setSyncStateAndDeriveSeedHex(
    id: String,
    icloudBackedUp: Bool,
    prompt: String
  ) throws -> String {
    let hasWrappedAES: Bool
    do {
      hasWrappedAES = try KeychainBridge.wrappedAESKeyExists(id: id)
    } catch {
      throw Exception(
        name: "E_KEYCHAIN_READ_FAILED",
        description: "Failed to probe wrapped AES key: \(error)"
      )
    }

    let hasMnemonicItem: Bool
    do {
      hasMnemonicItem = try KeychainBridge.mnemonicExists(id: id)
    } catch {
      throw Exception(
        name: "E_KEYCHAIN_READ_FAILED",
        description: "Failed to probe mnemonic item: \(error)"
      )
    }
    if !hasMnemonicItem && !hasWrappedAES {
      throw Exception(
        name: "E_NOT_FOUND",
        description: "No mnemonic stored for id \(id)"
      )
    }

    var mnemonicData = try readMnemonicData(id: id, prompt: prompt, hasWrappedAES: hasWrappedAES)
    defer { BIP39.zero(&mnemonicData) }
    let seed = try seedHex(from: mnemonicData)

    let currentlyIcloud = !hasWrappedAES
    if currentlyIcloud == icloudBackedUp {
      if !hasWrappedAES {
        do {
          try KeychainBridge.setSyncState(id: id, icloudBackedUp: icloudBackedUp)
        } catch KeychainError.unexpectedStatus(let status) where status == errSecItemNotFound {
          throw Exception(
            name: "E_NOT_FOUND",
            description: "No mnemonic stored for id \(id)"
          )
        } catch {
          throw Exception(
            name: "E_KEYCHAIN_WRITE_FAILED",
            description: "Failed to update mnemonic sync state: \(error)"
          )
        }
      }
      return seed
    }

    if icloudBackedUp {
      // Local (SE-wrapped) → iCloud (plaintext), reusing the mnemonic already
      // decrypted above so the user sees only one biometric prompt.
      try? KeychainBridge.deleteWrappedAESKey(id: id)
      do {
        try KeychainBridge.storeMnemonicPlaintext(
          id: id,
          mnemonic: mnemonicData,
          icloudBackedUp: true
        )
      } catch {
        throw Exception(
          name: "E_KEYCHAIN_WRITE_FAILED",
          description: "Failed to write synced plaintext mnemonic: \(error)"
        )
      }
      try? SecureEnclaveKey.delete(id: id)
    } else {
      // Plaintext → local (SE-wrapped). On simulator this still routes to
      // plaintext because `writeSEWrapped` is never reached from public flows
      // that compile with `targetEnvironment(simulator)`.
      #if targetEnvironment(simulator)
      do {
        try KeychainBridge.setSyncState(id: id, icloudBackedUp: false)
      } catch {
        throw Exception(
          name: "E_KEYCHAIN_WRITE_FAILED",
          description: "Failed to update simulator plaintext mnemonic sync state: \(error)"
        )
      }
      #else
      try MnemonicStorage.writeSEWrapped(id: id, mnemonicData: mnemonicData)
      try? KeychainBridge.deleteMnemonicPlaintext(id: id)
      #endif
    }

    return seed
  }

  private static func seedHex(from mnemonicData: Data) throws -> String {
    var seed = try BIP39.mnemonicToSeed(mnemonicData)
    defer { BIP39.zero(&seed) }
    return seed.map { String(format: "%02x", $0) }.joined()
  }

  private static func readMnemonicData(id: String, prompt: String) throws -> Data {
    let hasWrappedAES: Bool
    do {
      hasWrappedAES = try KeychainBridge.wrappedAESKeyExists(id: id)
    } catch {
      throw Exception(
        name: "E_KEYCHAIN_READ_FAILED",
        description: "Failed to probe wrapped AES key: \(error)"
      )
    }
    return try readMnemonicData(id: id, prompt: prompt, hasWrappedAES: hasWrappedAES)
  }

  private static func readMnemonicData(id: String, prompt: String, hasWrappedAES: Bool) throws -> Data {
    if hasWrappedAES {
      return try readSEWrappedMnemonicData(id: id, prompt: prompt)
    }
    return try readPlaintextMnemonicData(id: id)
  }

  private static func readSEWrappedMnemonicData(id: String, prompt: String) throws -> Data {
    let wrapped: Data
    do {
      guard let found = try KeychainBridge.readWrappedAESKey(id: id) else {
        throw Exception(
          name: "E_CORRUPT_STATE",
          description: "Wrapped AES key disappeared between probe and read for \(id)"
        )
      }
      wrapped = found
    } catch {
      throw Exception(
        name: "E_KEYCHAIN_READ_FAILED",
        description: "Failed to read wrapped AES key: \(error)"
      )
    }

    var aesKey: Data
    do {
      aesKey = try SecureEnclaveKey.unwrapAESKey(
        wrappedBlob: wrapped,
        id: id,
        prompt: prompt
      )
    } catch SecureEnclaveError.userCanceled {
      throw Exception(
        name: "E_USER_CANCELED",
        description: "Biometric prompt was canceled by the user"
      )
    } catch SecureEnclaveError.keyNotFound {
      throw Exception(
        name: "E_CORRUPT_STATE",
        description: "Wrapped AES key is present but SE private key is missing for \(id)"
      )
    } catch {
      throw Exception(
        name: "E_SE_UNWRAP_FAILED",
        description: "Failed to unwrap AES key: \(error)"
      )
    }
    defer { BIP39.zero(&aesKey) }

    let ciphertext: Data
    do {
      guard let found = try KeychainBridge.readMnemonicCiphertext(id: id) else {
        throw Exception(
          name: "E_CORRUPT_STATE",
          description: "Wrapped AES key exists but mnemonic ciphertext is missing for \(id)"
        )
      }
      ciphertext = found
    } catch {
      throw Exception(
        name: "E_KEYCHAIN_READ_FAILED",
        description: "Failed to read mnemonic ciphertext: \(error)"
      )
    }

    do {
      return try AESEncryption.decrypt(ciphertext: ciphertext, key: aesKey)
    } catch {
      throw Exception(
        name: "E_CRYPTO_FAILED",
        description: "Failed to decrypt mnemonic: \(error)"
      )
    }
  }

  private static func readPlaintextMnemonicData(id: String) throws -> Data {
    let data: Data?
    do {
      data = try KeychainBridge.readMnemonicPlaintext(id: id)
    } catch {
      throw Exception(
        name: "E_KEYCHAIN_READ_FAILED",
        description: "Failed to read mnemonic from Keychain: \(error)"
      )
    }
    guard let found = data else {
      throw Exception(
        name: "E_NOT_FOUND",
        description: "No mnemonic stored for id \(id)"
      )
    }
    return found
  }

  // MARK: - Sync-state migrations

  static func migrateLocalToICloud(id: String, prompt: String) throws {
    // Read wrapped AES key.
    let wrapped: Data
    do {
      guard let found = try KeychainBridge.readWrappedAESKey(id: id) else {
        throw Exception(
          name: "E_CORRUPT_STATE",
          description: "Wrapped AES key vanished mid-migration for \(id)"
        )
      }
      wrapped = found
    } catch {
      throw Exception(
        name: "E_KEYCHAIN_READ_FAILED",
        description: "Failed to read wrapped AES key: \(error)"
      )
    }

    // Biometric prompt happens here.
    var aesKey: Data
    do {
      aesKey = try SecureEnclaveKey.unwrapAESKey(
        wrappedBlob: wrapped,
        id: id,
        prompt: prompt
      )
    } catch SecureEnclaveError.userCanceled {
      throw Exception(
        name: "E_USER_CANCELED",
        description: "Biometric prompt was canceled by the user"
      )
    } catch {
      throw Exception(
        name: "E_SE_UNWRAP_FAILED",
        description: "Failed to unwrap AES key: \(error)"
      )
    }
    defer { BIP39.zero(&aesKey) }

    let ciphertext: Data
    do {
      guard let found = try KeychainBridge.readMnemonicCiphertext(id: id) else {
        throw Exception(
          name: "E_CORRUPT_STATE",
          description: "Wrapped AES key exists but mnemonic ciphertext is missing for \(id)"
        )
      }
      ciphertext = found
    } catch {
      throw Exception(
        name: "E_KEYCHAIN_READ_FAILED",
        description: "Failed to read mnemonic ciphertext: \(error)"
      )
    }

    var mnemonicData: Data
    do {
      mnemonicData = try AESEncryption.decrypt(ciphertext: ciphertext, key: aesKey)
    } catch {
      throw Exception(
        name: "E_CRYPTO_FAILED",
        description: "Failed to decrypt mnemonic: \(error)"
      )
    }
    defer { BIP39.zero(&mnemonicData) }

    // Destructive phase. All reads and the biometric prompt are done; the
    // mnemonic is in `mnemonicData`. Order matters for crash-resilience:
    //
    //   1. Delete the wrapped AES key FIRST. After this point, reveal
    //      cannot pick the SE path (path selection is based on the wrapped
    //      AES key's presence). If we crashed between writing plaintext
    //      and deleting the wrapped AES key, reveal would still think the
    //      item is SE-wrapped, try to unwrap a ciphertext that isn't
    //      there, and fail in a confusing way.
    //   2. Store the plaintext. `storeMnemonicPlaintext` internally
    //      deletes any pre-existing item at the same service (the
    //      ciphertext), so plaintext cleanly replaces ciphertext.
    //   3. Delete the SE key (dangling hardware-backed artifact with no
    //      remaining use).
    //
    // A crash between 1 and 2 leaves the wallet unreadable but the user
    // has already written down the recovery phrase as a prerequisite to
    // reaching this screen, so recovery-from-seed is available.
    try? KeychainBridge.deleteWrappedAESKey(id: id)

    do {
      try KeychainBridge.storeMnemonicPlaintext(
        id: id,
        mnemonic: mnemonicData,
        icloudBackedUp: true
      )
    } catch {
      throw Exception(
        name: "E_KEYCHAIN_WRITE_FAILED",
        description: "Failed to write synced plaintext mnemonic: \(error)"
      )
    }

    try? SecureEnclaveKey.delete(id: id)
  }

  static func migrateICloudToLocal(id: String) throws {
    // Read the plaintext mnemonic (no biometric prompt — plaintext path).
    var mnemonicData: Data
    do {
      guard let found = try KeychainBridge.readMnemonicPlaintext(id: id) else {
        throw Exception(
          name: "E_NOT_FOUND",
          description: "No mnemonic stored for id \(id)"
        )
      }
      mnemonicData = found
    } catch {
      throw Exception(
        name: "E_KEYCHAIN_READ_FAILED",
        description: "Failed to read mnemonic: \(error)"
      )
    }
    defer { BIP39.zero(&mnemonicData) }

    // Write SE-wrapped version first (handles its own rollback on failure).
    try MnemonicStorage.writeSEWrapped(id: id, mnemonicData: mnemonicData)

    // Delete the old plaintext+synced item. If this fails we keep going —
    // the wallet is already usable via the new SE path.
    try? KeychainBridge.deleteMnemonicPlaintext(id: id)
  }
}
