import Foundation
import LocalAuthentication
import Security

enum SecureEnclaveError: Error {
  case seUnavailable
  case accessControlCreationFailed
  case keyGenerationFailed(OSStatus)
  case keyNotFound
  case publicKeyExtractionFailed
  case algorithmUnsupported
  case wrapFailed(Error)
  case unwrapFailed(Error)
  case userCanceled
}

/// Secure Enclave key lifecycle helpers.
///
/// We use a P-256 key generated *inside* the Secure Enclave, non-exportable,
/// gated by user presence (biometrics OR device passcode). The key is used
/// only to wrap / unwrap a per-wallet AES-256 data-protection key via the
/// ECIES envelope offered by `SecKeyCreateEncryptedData` with
/// `.eciesEncryptionCofactorX963SHA256AESGCM`.
///
/// The biometric (or passcode) prompt is presented by iOS when the private
/// key is *used* — specifically when `SecKeyCreateDecryptedData` performs
/// the ECDH step. Creation, lookup, and deletion do NOT trigger any prompt.
///
/// Access control choice — `.userPresence` vs `.biometryCurrentSet`:
///
/// We use `[.privateKeyUsage, .userPresence]`. `.userPresence` allows Touch
/// ID / Face ID OR the device passcode as a fallback, which means users who
/// have disabled biometrics (or whose biometric enrollment changes) are not
/// locked out of their wallet. `.biometryCurrentSet` would invalidate the
/// SE key any time the user added or removed a fingerprint / face, forcing
/// them into a recovery flow we do not yet support. For MVP this is the
/// right trade-off; the security boundary is still "attacker needs either
/// biometrics or the passcode", which is the same guarantee iCloud Keychain
/// itself relies on.
enum SecureEnclaveKey {

  // MARK: - Availability

  /// Returns true when the Secure Enclave is usable on this device/simulator.
  ///
  /// Strategy: attempt to create a transient SE key with the same flags we
  /// use for real wallet keys. If creation succeeds we delete it immediately.
  /// This is the most reliable probe across iOS simulator versions — the
  /// simulator's SE is software-emulated and does not behave identically to
  /// a real T2 / A-series secure enclave (see README for caveats).
  static func isAvailable() -> Bool {
    guard let access = makeAccessControl() else { return false }
    let probeTag = "wallet.se.__probe__".data(using: .utf8)!
    let attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: false,
        kSecAttrApplicationTag as String: probeTag,
        kSecAttrAccessControl as String: access,
      ],
    ]
    var error: Unmanaged<CFError>?
    let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error)
    error?.release()
    return key != nil
  }

  // MARK: - Tag

  /// The Keychain application tag used to look up the SE private key for
  /// a given wallet id. Must round-trip UTF-8 so we can `data(using: .utf8)!`
  /// safely.
  static func tag(for id: String) -> Data {
    return ("wallet.se." + id).data(using: .utf8)!
  }

  // MARK: - Access control

  /// Builds the access control object applied to every SE key we create.
  /// See the type-level doc comment on access control choice.
  private static func makeAccessControl() -> SecAccessControl? {
    var error: Unmanaged<CFError>?
    let access = SecAccessControlCreateWithFlags(
      nil,
      kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      [.privateKeyUsage, .userPresence],
      &error
    )
    error?.release()
    return access
  }

  // MARK: - Create

  /// Create a new Secure Enclave P-256 key bound to `id`. Does NOT trigger
  /// a biometric prompt — generation happens without user presence; usage
  /// (decryption) is what iOS gates.
  static func create(id: String) throws -> SecKey {
    guard let access = makeAccessControl() else {
      throw SecureEnclaveError.accessControlCreationFailed
    }
    let attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: tag(for: id),
        kSecAttrAccessControl as String: access,
      ],
    ]
    var error: Unmanaged<CFError>?
    guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
      let cfError = error?.takeRetainedValue()
      let status = OSStatus((cfError.flatMap { CFErrorGetCode($0) }) ?? -1)
      throw SecureEnclaveError.keyGenerationFailed(status)
    }
    return key
  }

  // MARK: - Load

  /// Fetch the SE private key handle for `id`. No biometric prompt — the
  /// prompt is deferred until the handle is used to decrypt.
  static func load(id: String) throws -> SecKey {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag(for: id),
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecReturnRef as String: true,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound {
      throw SecureEnclaveError.keyNotFound
    }
    guard status == errSecSuccess, let item = item else {
      throw SecureEnclaveError.keyGenerationFailed(status)
    }
    // `SecItemCopyMatching` returns `CFTypeRef`; cast through safely.
    return item as! SecKey
  }

  // MARK: - Delete

  /// Deletes the SE key for `id`. Idempotent; swallows `errSecItemNotFound`.
  static func delete(id: String) throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag(for: id),
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
    ]
    let status = SecItemDelete(query as CFDictionary)
    if status != errSecSuccess && status != errSecItemNotFound {
      throw SecureEnclaveError.keyGenerationFailed(status)
    }
  }

  // MARK: - Public key

  static func publicKey(of privateKey: SecKey) throws -> SecKey {
    guard let pub = SecKeyCopyPublicKey(privateKey) else {
      throw SecureEnclaveError.publicKeyExtractionFailed
    }
    return pub
  }

  // MARK: - Wrap / Unwrap

  private static let wrappingAlgorithm: SecKeyAlgorithm =
    .eciesEncryptionCofactorX963SHA256AESGCM

  /// Encrypt a 32-byte AES key blob with the SE public key using ECIES.
  /// The SE key for `id` must already exist — call `create(id:)` first.
  ///
  /// This does NOT trigger a biometric prompt: ECIES encryption uses the
  /// public key only (the private key is never touched). The prompt fires
  /// on `unwrapAESKey`.
  static func wrapAESKey(_ aesKey: Data, id: String) throws -> Data {
    let privateKey = try load(id: id)
    let publicKey = try publicKey(of: privateKey)
    guard SecKeyIsAlgorithmSupported(publicKey, .encrypt, wrappingAlgorithm) else {
      throw SecureEnclaveError.algorithmUnsupported
    }
    var error: Unmanaged<CFError>?
    guard
      let cipher = SecKeyCreateEncryptedData(
        publicKey,
        wrappingAlgorithm,
        aesKey as CFData,
        &error
      )
    else {
      let err = error?.takeRetainedValue()
      throw SecureEnclaveError.wrapFailed(err ?? NSError(domain: "SE", code: -1))
    }
    return cipher as Data
  }

  /// Decrypt an SE-wrapped AES key blob. **Triggers the biometric prompt.**
  /// The caller is responsible for zeroing the returned `Data` as soon as
  /// it is no longer needed.
  ///
  /// `prompt` becomes the localized reason shown in the Face ID / Touch ID
  /// / passcode sheet. We pass an `LAContext` via the key query so the
  /// prompt text is set before the key is used.
  static func unwrapAESKey(wrappedBlob: Data, id: String, prompt: String) throws -> Data {
    let context = LAContext()
    context.localizedReason = prompt

    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag(for: id),
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecReturnRef as String: true,
      kSecUseAuthenticationContext as String: context,
      kSecUseOperationPrompt as String: prompt,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound {
      throw SecureEnclaveError.keyNotFound
    }
    if status == errSecUserCanceled || status == errSecAuthFailed {
      throw SecureEnclaveError.userCanceled
    }
    guard status == errSecSuccess, let item = item else {
      throw SecureEnclaveError.keyGenerationFailed(status)
    }
    let privateKey = item as! SecKey

    guard SecKeyIsAlgorithmSupported(privateKey, .decrypt, wrappingAlgorithm) else {
      throw SecureEnclaveError.algorithmUnsupported
    }

    var error: Unmanaged<CFError>?
    guard
      let plain = SecKeyCreateDecryptedData(
        privateKey,
        wrappingAlgorithm,
        wrappedBlob as CFData,
        &error
      )
    else {
      let cfError = error?.takeRetainedValue()
      // `errSecUserCanceled` is -128; LAError.userCancel is -2 in the
      // `com.apple.LocalAuthentication` domain. Map either to our own
      // `userCanceled` case so the JS bridge can distinguish user cancels
      // from hard failures.
      if let cfError = cfError {
        let code = CFErrorGetCode(cfError)
        let domain = CFErrorGetDomain(cfError) as String
        if code == Int(errSecUserCanceled)
          || code == -128
          || (domain == "com.apple.LocalAuthentication" && (code == -2 || code == -4 || code == -9))
        {
          throw SecureEnclaveError.userCanceled
        }
        throw SecureEnclaveError.unwrapFailed(cfError)
      }
      throw SecureEnclaveError.unwrapFailed(NSError(domain: "SE", code: -1))
    }
    return plain as Data
  }
}
