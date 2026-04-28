import XCTest

@testable import WalletCrypto

/// Round-trip, tamper, and key-handling tests for the AES-256-GCM helpers
/// that back the Stage 6b mnemonic ciphertext storage.
final class AESEncryptionTests: XCTestCase {

  // MARK: - Round-trip

  func testEncryptThenDecryptReturnsOriginalPlaintext() throws {
    let key = try AESEncryption.randomKey()
    let plaintext = "test mnemonic with twenty four words for stage six b encryption round trip".data(
      using: .utf8)!
    let ciphertext = try AESEncryption.encrypt(plaintext: plaintext, key: key)
    let recovered = try AESEncryption.decrypt(ciphertext: ciphertext, key: key)
    XCTAssertEqual(recovered, plaintext)
  }

  func testEncryptedOutputHasNoncePrefix() throws {
    let key = try AESEncryption.randomKey()
    let plaintext = Data("hello".utf8)
    let ciphertext = try AESEncryption.encrypt(plaintext: plaintext, key: key)
    // Combined format is `nonce(12) || ciphertext(N) || tag(16)`. For a
    // 5-byte plaintext, combined length must be 12 + 5 + 16 = 33 bytes.
    XCTAssertEqual(ciphertext.count, 12 + plaintext.count + 16)
  }

  func testTwoEncryptionsOfSamePlaintextProduceDifferentCiphertexts() throws {
    let key = try AESEncryption.randomKey()
    let plaintext = Data("nonce freshness check".utf8)
    let a = try AESEncryption.encrypt(plaintext: plaintext, key: key)
    let b = try AESEncryption.encrypt(plaintext: plaintext, key: key)
    XCTAssertNotEqual(a, b, "GCM nonce must be fresh on every seal call")
  }

  // MARK: - Failure modes

  func testDecryptWithWrongKeyThrows() throws {
    let key = try AESEncryption.randomKey()
    let wrongKey = try AESEncryption.randomKey()
    let ciphertext = try AESEncryption.encrypt(plaintext: Data("payload".utf8), key: key)
    XCTAssertThrowsError(try AESEncryption.decrypt(ciphertext: ciphertext, key: wrongKey))
  }

  func testDecryptOfMalformedCiphertextThrows() throws {
    let key = try AESEncryption.randomKey()
    let garbage = Data([0x00, 0x01, 0x02])  // too short for nonce+tag
    XCTAssertThrowsError(try AESEncryption.decrypt(ciphertext: garbage, key: key)) { error in
      guard let e = error as? AESError else {
        XCTFail("Unexpected error type: \(error)")
        return
      }
      switch e {
      case .invalidCiphertext: break
      default: XCTFail("Expected .invalidCiphertext, got \(e)")
      }
    }
  }

  func testDecryptOfTamperedCiphertextThrows() throws {
    let key = try AESEncryption.randomKey()
    var ciphertext = try AESEncryption.encrypt(plaintext: Data("abcd".utf8), key: key)
    // Flip a bit in the middle of the ciphertext (not the nonce, not the
    // tag — just the encrypted body) so GCM auth fails.
    let flipIndex = 12 + 2
    ciphertext[flipIndex] ^= 0x01
    XCTAssertThrowsError(try AESEncryption.decrypt(ciphertext: ciphertext, key: key))
  }

  func testEncryptRejectsInvalidKeyLength() {
    let shortKey = Data(repeating: 0, count: 16)  // AES-128 key is not accepted
    XCTAssertThrowsError(try AESEncryption.encrypt(plaintext: Data("x".utf8), key: shortKey)) {
      error in
      guard let e = error as? AESError else {
        XCTFail("Unexpected error type: \(error)")
        return
      }
      switch e {
      case .invalidKeyLength: break
      default: XCTFail("Expected .invalidKeyLength, got \(e)")
      }
    }
  }

  // MARK: - Key helper

  func testRandomKeyProduces32Bytes() throws {
    let key = try AESEncryption.randomKey()
    XCTAssertEqual(key.count, 32)
  }

  func testRandomKeyIsNonDeterministic() throws {
    let a = try AESEncryption.randomKey()
    let b = try AESEncryption.randomKey()
    XCTAssertNotEqual(a, b)
  }
}
