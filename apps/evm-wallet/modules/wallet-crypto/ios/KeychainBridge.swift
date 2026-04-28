import Foundation
import Security

enum KeychainError: Error {
  case unexpectedStatus(OSStatus)
  case itemDataMalformed
}

/// Thin wrapper around the iOS `Security` framework for the Stage 6b
/// dual-mode mnemonic storage layout.
///
/// Service names (each item uses `kSecAttrAccount = "mnemonic"`):
///
/// - `wallet.mnemonic.<id>` — either the plaintext mnemonic UTF-8 bytes
///   (iCloud path) OR the AES-256-GCM ciphertext of the mnemonic (local /
///   Secure-Enclave path). The caller disambiguates by checking whether
///   `wallet.aeskey.<id>` exists: if it does, the mnemonic blob is
///   ciphertext.
/// - `wallet.aeskey.<id>` — the Secure-Enclave-wrapped AES-256 key
///   ciphertext. Present only for the local / SE path. Never synced to
///   iCloud (the SE private key that would unwrap it is non-exportable).
///
/// The Secure Enclave private key itself is stored outside this module in
/// `SecureEnclaveKey.swift` under `kSecAttrApplicationTag = "wallet.se.<id>"`.
///
/// Keep `service(for:)` in sync with `mnemonicService(id)` in
/// `src/lib/storage/secure.ts` — `react-native-keychain` reads items by
/// that service name for dev / migration diagnostics.
enum KeychainBridge {
  private static let account: String = "mnemonic"

  // MARK: - Service names

  static func service(for id: String) -> String {
    return "wallet.mnemonic.\(id)"
  }

  static func aesKeyService(for id: String) -> String {
    return "wallet.aeskey.\(id)"
  }

  // MARK: - Write (mnemonic, plaintext — iCloud path)

  /// Stores the raw UTF-8 mnemonic bytes under `wallet.mnemonic.<id>`.
  /// This is the Stage 6 storage shape, retained for iCloud-backed wallets
  /// where SE wrapping is inapplicable (the SE key cannot leave the device).
  static func storeMnemonicPlaintext(id: String, mnemonic: Data, icloudBackedUp: Bool) throws {
    try storeItem(service: service(for: id), data: mnemonic, icloudBackedUp: icloudBackedUp)
  }

  // MARK: - Write (mnemonic, ciphertext — local / SE path)

  /// Stores the AES-256-GCM ciphertext under `wallet.mnemonic.<id>`. The
  /// item is always local-only (`WhenUnlockedThisDeviceOnly`, no
  /// `kSecAttrSynchronizable`) because the SE key required to decrypt the
  /// wrapped AES key is itself local-only.
  static func storeMnemonicCiphertext(id: String, ciphertext: Data) throws {
    try storeItem(service: service(for: id), data: ciphertext, icloudBackedUp: false)
  }

  // MARK: - Write (wrapped AES key)

  /// Stores the SE-wrapped AES-256 key ciphertext under
  /// `wallet.aeskey.<id>`. `icloudBackedUp` is accepted for symmetry but
  /// the Stage 6b design never syncs the wrapped AES key (the SE key that
  /// would unwrap it is device-bound) — callers always pass `false`.
  static func storeWrappedAESKey(id: String, wrapped: Data, icloudBackedUp: Bool) throws {
    try storeItem(service: aesKeyService(for: id), data: wrapped, icloudBackedUp: icloudBackedUp)
  }

  // MARK: - Read

  static func readMnemonicPlaintext(id: String) throws -> Data? {
    return try readIfExists(service: service(for: id))
  }

  static func readMnemonicCiphertext(id: String) throws -> Data? {
    return try readIfExists(service: service(for: id))
  }

  static func readWrappedAESKey(id: String) throws -> Data? {
    return try readIfExists(service: aesKeyService(for: id))
  }

  // MARK: - Exists

  static func mnemonicExists(id: String) throws -> Bool {
    return try itemExists(service: service(for: id))
  }

  static func wrappedAESKeyExists(id: String) throws -> Bool {
    return try itemExists(service: aesKeyService(for: id))
  }

  // MARK: - Delete

  static func deleteMnemonicPlaintext(id: String) throws {
    try deleteItem(service: service(for: id))
  }

  static func deleteMnemonicCiphertext(id: String) throws {
    try deleteItem(service: service(for: id))
  }

  static func deleteWrappedAESKey(id: String) throws {
    try deleteItem(service: aesKeyService(for: id))
  }

  // MARK: - Sync-state migration (plaintext only)

  /// Changes the synchronizable / accessibility flags of the plaintext
  /// mnemonic item in place, preserving the stored bytes. Used only on the
  /// iCloud path after Stage 6b — the SE / ciphertext path cannot be
  /// migrated this way because the wrapped AES key cannot sync.
  static func setSyncState(id: String, icloudBackedUp: Bool) throws {
    guard var data = try readIfExists(service: service(for: id)) else {
      throw KeychainError.unexpectedStatus(errSecItemNotFound)
    }
    defer {
      data.withUnsafeMutableBytes { ptr in
        guard let base = ptr.baseAddress, ptr.count > 0 else { return }
        memset_s(base, ptr.count, 0, ptr.count)
      }
    }
    try storeMnemonicPlaintext(id: id, mnemonic: data, icloudBackedUp: icloudBackedUp)
  }

  // MARK: - Internal primitives

  private static func storeItem(service: String, data: Data, icloudBackedUp: Bool) throws {
    // Delete any prior entry (either sync variant) so add is deterministic.
    _ = deleteBoth(service: service)

    let accessibility: CFString = icloudBackedUp
      ? kSecAttrAccessibleAfterFirstUnlock
      : kSecAttrAccessibleWhenUnlockedThisDeviceOnly

    var attributes: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecValueData as String: data,
      kSecAttrAccessible as String: accessibility,
    ]
    if icloudBackedUp {
      attributes[kSecAttrSynchronizable as String] = kCFBooleanTrue
    }

    let status = SecItemAdd(attributes as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw KeychainError.unexpectedStatus(status)
    }
  }

  private static func readIfExists(service: String) throws -> Data? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecReturnData as String: kCFBooleanTrue as Any,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound {
      return nil
    }
    guard status == errSecSuccess else {
      throw KeychainError.unexpectedStatus(status)
    }
    guard let data = item as? Data else {
      throw KeychainError.itemDataMalformed
    }
    return data
  }

  private static func itemExists(service: String) throws -> Bool {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecReturnData as String: kCFBooleanFalse as Any,
    ]
    let status = SecItemCopyMatching(query as CFDictionary, nil)
    switch status {
    case errSecSuccess:
      return true
    case errSecItemNotFound:
      return false
    default:
      throw KeychainError.unexpectedStatus(status)
    }
  }

  private static func deleteItem(service: String) throws {
    let errors = deleteBoth(service: service)
    if !errors.isEmpty {
      throw KeychainError.unexpectedStatus(errors[0])
    }
  }

  /// Issue two deletes — one plain, one with `kSecAttrSynchronizableAny` —
  /// so both the local and synced variants of a given (service, account)
  /// pair are purged regardless of how the item was originally written.
  @discardableResult
  private static func deleteBoth(service: String) -> [OSStatus] {
    let plainQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    let anyQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
    ]

    var errors: [OSStatus] = []
    for query in [plainQuery, anyQuery] {
      let status = SecItemDelete(query as CFDictionary)
      if status != errSecSuccess && status != errSecItemNotFound {
        errors.append(status)
      }
    }
    return errors
  }
}
