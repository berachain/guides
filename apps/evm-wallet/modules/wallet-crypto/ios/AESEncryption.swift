import CryptoKit
import Foundation
import Security

enum AESError: Error {
  case invalidKeyLength
  case encryptionFailed(Error)
  case decryptionFailed(Error)
  case invalidCiphertext
  case randomBytesFailed(OSStatus)
}

/// AES-256-GCM helpers used by the Stage 6b mnemonic storage pipeline.
///
/// The `combined` representation returned by `AES.GCM.SealedBox` is the
/// concatenation `nonce || ciphertext || tag` (12 + N + 16 bytes for the
/// default 12-byte GCM nonce). Callers store the combined blob verbatim
/// and we reconstruct the `SealedBox` on decrypt. This avoids us having to
/// manage nonces ourselves — CryptoKit generates a fresh random 12-byte
/// nonce on every `.seal` call.
enum AESEncryption {
  static let keyByteCount: Int = 32

  /// Generate a fresh 32-byte key using `SecRandomCopyBytes`. Returned as
  /// `Data`; the caller must zero it with `memset_s` when finished.
  static func randomKey() throws -> Data {
    var key = Data(count: keyByteCount)
    let status = key.withUnsafeMutableBytes { ptr -> OSStatus in
      guard let base = ptr.baseAddress else { return errSecAllocate }
      return SecRandomCopyBytes(kSecRandomDefault, keyByteCount, base)
    }
    if status != errSecSuccess {
      BIP39.zero(&key)
      throw AESError.randomBytesFailed(status)
    }
    return key
  }

  /// AES-256-GCM encrypt. Returns the CryptoKit "combined" blob —
  /// `nonce(12) || ciphertext(N) || tag(16)`.
  static func encrypt(plaintext: Data, key: Data) throws -> Data {
    guard key.count == keyByteCount else {
      throw AESError.invalidKeyLength
    }
    let symmetricKey = SymmetricKey(data: key)
    do {
      let sealed = try AES.GCM.seal(plaintext, using: symmetricKey)
      guard let combined = sealed.combined else {
        // `combined` is nil only when a non-default nonce length was used;
        // we never pass a custom nonce so this branch is unreachable.
        throw AESError.encryptionFailed(
          NSError(domain: "AES", code: -1, userInfo: [NSLocalizedDescriptionKey: "No combined representation"])
        )
      }
      return combined
    } catch let error as AESError {
      throw error
    } catch {
      throw AESError.encryptionFailed(error)
    }
  }

  /// AES-256-GCM decrypt. Expects the CryptoKit combined format.
  /// The returned `Data` is the plaintext — the caller must zero it when
  /// finished.
  static func decrypt(ciphertext: Data, key: Data) throws -> Data {
    guard key.count == keyByteCount else {
      throw AESError.invalidKeyLength
    }
    let symmetricKey = SymmetricKey(data: key)
    let sealedBox: AES.GCM.SealedBox
    do {
      sealedBox = try AES.GCM.SealedBox(combined: ciphertext)
    } catch {
      throw AESError.invalidCiphertext
    }
    do {
      return try AES.GCM.open(sealedBox, using: symmetricKey)
    } catch {
      throw AESError.decryptionFailed(error)
    }
  }
}
