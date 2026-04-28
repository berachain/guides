import XCTest

@testable import WalletCrypto

/// Tests for the `SecureEnclaveKey` helpers.
///
/// IMPORTANT: iOS Simulator cannot reliably evaluate the
/// DeviceOwnerAuthentication access control required by real Secure Enclave
/// keys. Tests that touch SE key material skip when this runtime cannot create
/// the required key; public simulator app flows are covered by the plaintext
/// fallback in `WalletCryptoModule`.
final class SecureEnclaveTests: XCTestCase {

  private var testId: String!

  override func setUp() {
    super.setUp()
    testId = "test.\(UUID().uuidString)"
  }

  override func tearDown() {
    if let id = testId {
      try? SecureEnclaveKey.delete(id: id)
    }
    testId = nil
    super.tearDown()
  }

  // MARK: - Availability

  func testAvailabilityProbeCanRun() {
    _ = SecureEnclaveKey.isAvailable()
  }

  // MARK: - Key lifecycle

  func testCreateThenLoadReturnsUsableKey() throws {
    try requireSecureEnclaveAvailable()
    _ = try SecureEnclaveKey.create(id: testId)
    let loaded = try SecureEnclaveKey.load(id: testId)
    // The returned value is a SecKey handle — extracting the public key
    // confirms the handle is live and addressable.
    let pub = try SecureEnclaveKey.publicKey(of: loaded)
    XCTAssertNotNil(SecKeyCopyExternalRepresentation(pub, nil))
  }

  func testCreateThenDeleteMakesLoadThrowKeyNotFound() throws {
    try requireSecureEnclaveAvailable()
    _ = try SecureEnclaveKey.create(id: testId)
    try SecureEnclaveKey.delete(id: testId)
    XCTAssertThrowsError(try SecureEnclaveKey.load(id: testId)) { error in
      guard let e = error as? SecureEnclaveError else {
        XCTFail("Unexpected error type: \(error)")
        return
      }
      switch e {
      case .keyNotFound: break
      default: XCTFail("Expected .keyNotFound, got \(e)")
      }
    }
  }

  func testDeleteIsIdempotent() throws {
    // No key ever created — delete should not throw.
    XCTAssertNoThrow(try SecureEnclaveKey.delete(id: testId))
  }

  // MARK: - Wrap / unwrap

  func testWrapUnwrapRoundTripReturnsOriginalKey() throws {
    try requireSecureEnclaveAvailable()
    _ = try SecureEnclaveKey.create(id: testId)
    let aesKey = try AESEncryption.randomKey()
    let wrapped = try SecureEnclaveKey.wrapAESKey(aesKey, id: testId)
    XCTAssertNotEqual(wrapped, aesKey, "ECIES output must differ from plaintext")
    // On device this call touches the Secure Enclave private key and may
    // surface a Face ID / Touch ID / passcode sheet that XCTest cannot dismiss
    // here.
    let unwrapped = try SecureEnclaveKey.unwrapAESKey(
      wrappedBlob: wrapped,
      id: testId,
      prompt: "test"
    )
    XCTAssertEqual(unwrapped, aesKey)
  }

  func testWrapWithoutExistingKeyThrowsKeyNotFound() throws {
    let aesKey = try AESEncryption.randomKey()
    XCTAssertThrowsError(try SecureEnclaveKey.wrapAESKey(aesKey, id: testId)) { error in
      guard let e = error as? SecureEnclaveError else {
        XCTFail("Unexpected error type: \(error)")
        return
      }
      switch e {
      case .keyNotFound: break
      default: XCTFail("Expected .keyNotFound, got \(e)")
      }
    }
  }

  // MARK: - End-to-end Stage 6b pipeline

  /// Exercise the full Stage 6b SE-wrapped storage pipeline when this runtime
  /// supports it: generate BIP39 → AES-encrypt → SE-wrap AES key → SE-unwrap
  /// → AES-decrypt → assert equality. Runs across three distinct 24-word
  /// mnemonics to guard against single-vector flukes.
  func testStage6bRoundTripForMultipleMnemonics() throws {
    try requireSecureEnclaveAvailable()
    let entropyHexVectors = [
      // All-zero entropy: `abandon abandon ... art`
      "0000000000000000000000000000000000000000000000000000000000000000",
      // All-ones: `zoo zoo ... vote`
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      // Random-looking mid-range: `letter advice ... bless`
      "8080808080808080808080808080808080808080808080808080808080808080",
    ]

    for hex in entropyHexVectors {
      let roundTripId = "test.roundtrip.\(UUID().uuidString)"
      defer { try? SecureEnclaveKey.delete(id: roundTripId) }

      let entropy = Self.dataFromHex(hex)
      let words = try BIP39.mnemonicFromEntropy(entropy)
      let mnemonic = BIP39.mnemonicToString(words)
      let mnemonicData = mnemonic.data(using: .utf8)!

      let aesKey = try AESEncryption.randomKey()
      let ciphertext = try AESEncryption.encrypt(plaintext: mnemonicData, key: aesKey)

      _ = try SecureEnclaveKey.create(id: roundTripId)
      let wrapped = try SecureEnclaveKey.wrapAESKey(aesKey, id: roundTripId)

      let unwrapped = try SecureEnclaveKey.unwrapAESKey(
        wrappedBlob: wrapped,
        id: roundTripId,
        prompt: "round trip"
      )
      XCTAssertEqual(unwrapped, aesKey)

      let recovered = try AESEncryption.decrypt(ciphertext: ciphertext, key: unwrapped)
      XCTAssertEqual(recovered, mnemonicData)
      XCTAssertEqual(String(data: recovered, encoding: .utf8), mnemonic)
    }
  }

  // MARK: - Helpers

  private func requireSecureEnclaveAvailable() throws {
    try XCTSkipIf(
      !SecureEnclaveKey.isAvailable(),
      "Secure Enclave DeviceOwnerAuthentication is unavailable on this runtime"
    )
  }

  private static func dataFromHex(_ hex: String) -> Data {
    var data = Data()
    data.reserveCapacity(hex.count / 2)
    var index = hex.startIndex
    while index < hex.endIndex {
      let next = hex.index(index, offsetBy: 2)
      let byte = UInt8(hex[index..<next], radix: 16)!
      data.append(byte)
      index = next
    }
    return data
  }
}
