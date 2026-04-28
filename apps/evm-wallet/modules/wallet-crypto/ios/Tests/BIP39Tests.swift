import XCTest

@testable import WalletCrypto

/// Known-answer BIP39 test vectors from trezor/python-mnemonic
/// (https://github.com/trezor/python-mnemonic/blob/master/vectors.json),
/// English wordlist.
final class BIP39Tests: XCTestCase {
  private struct Vector {
    let entropyHex: String
    let mnemonic: String
  }

  private let vectors: [Vector] = [
    Vector(
      entropyHex: "00000000000000000000000000000000",
      mnemonic:
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
    ),
    Vector(
      entropyHex: "7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f",
      mnemonic:
        "legal winner thank year wave sausage worth useful legal winner thank yellow"
    ),
    Vector(
      entropyHex: "80808080808080808080808080808080",
      mnemonic:
        "letter advice cage absurd amount doctor acoustic avoid letter advice cage above"
    ),
    Vector(
      entropyHex: "ffffffffffffffffffffffffffffffff",
      mnemonic: "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"
    ),
    Vector(
      entropyHex: "0000000000000000000000000000000000000000000000000000000000000000",
      mnemonic:
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art"
    ),
    Vector(
      entropyHex: "7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f",
      mnemonic:
        "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title"
    ),
    Vector(
      entropyHex: "8080808080808080808080808080808080808080808080808080808080808080",
      mnemonic:
        "letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless"
    ),
    Vector(
      entropyHex: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      mnemonic:
        "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote"
    ),
  ]

  // MARK: - Wordlist shape

  func testWordlistIsExactly2048Words() {
    XCTAssertEqual(BIP39Wordlist.words.count, 2048)
    XCTAssertEqual(BIP39Wordlist.words.first, "abandon")
    XCTAssertEqual(BIP39Wordlist.words.last, "zoo")
  }

  func testWordlistIsLexicographicallySorted() {
    for i in 1..<BIP39Wordlist.words.count {
      XCTAssertLessThan(
        BIP39Wordlist.words[i - 1],
        BIP39Wordlist.words[i],
        "Wordlist must be sorted for binary search at index \(i)"
      )
    }
  }

  // MARK: - Entropy → mnemonic

  func testEntropyToMnemonicVectors() throws {
    for (i, vec) in vectors.enumerated() {
      let entropy = Self.dataFromHex(vec.entropyHex)
      let words = try BIP39.mnemonicFromEntropy(entropy)
      XCTAssertEqual(
        BIP39.mnemonicToString(words),
        vec.mnemonic,
        "Vector #\(i) (entropy=\(vec.entropyHex)) mismatch"
      )
    }
  }

  // MARK: - Validation

  func testValidateAcceptsKnownMnemonics() throws {
    for vec in vectors {
      try XCTAssertTrue(BIP39.validate(mnemonic: vec.mnemonic))
    }
  }

  func testValidateRejectsBadChecksum() {
    // Valid mnemonic with last word swapped for another valid wordlist entry
    // whose checksum does not match.
    let bad =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon"
    XCTAssertThrowsError(try BIP39.validate(mnemonic: bad)) { error in
      guard let e = error as? BIP39Error else {
        XCTFail("Unexpected error: \(error)")
        return
      }
      XCTAssertEqual(e, .checksumFailed)
    }
  }

  func testValidateRejectsUnknownWord() {
    let bad = "notaword abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
    XCTAssertThrowsError(try BIP39.validate(mnemonic: bad)) { error in
      guard let e = error as? BIP39Error else {
        XCTFail("Unexpected error: \(error)")
        return
      }
      XCTAssertEqual(e, .unknownWord)
    }
  }

  func testValidateRejectsBadWordCount() {
    let bad = "abandon abandon abandon"
    XCTAssertThrowsError(try BIP39.validate(mnemonic: bad)) { error in
      guard let e = error as? BIP39Error else {
        XCTFail("Unexpected error: \(error)")
        return
      }
      XCTAssertEqual(e, .invalidWordCount)
    }
  }

  // MARK: - Generation

  func testGenerateProducesValidMnemonic() throws {
    let result = try BIP39.generateMnemonic(entropyBits: 256)
    defer { result.cleanup() }
    XCTAssertEqual(result.words.count, 24)
    try XCTAssertTrue(BIP39.validate(mnemonic: BIP39.mnemonicToString(result.words)))
  }

  func testGenerateProducesDistinctMnemonics() throws {
    let a = try BIP39.generateMnemonic(entropyBits: 256)
    defer { a.cleanup() }
    let b = try BIP39.generateMnemonic(entropyBits: 256)
    defer { b.cleanup() }
    XCTAssertNotEqual(a.words, b.words)
  }

  func testGenerateRejectsInvalidEntropyLength() {
    XCTAssertThrowsError(try BIP39.generateMnemonic(entropyBits: 200))
  }

  // MARK: - Seed derivation

  func testMnemonicToSeedVectors() throws {
    let seedVectors: [(mnemonic: String, seedHex: String)] = [
      (
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        "c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04"
      ),
      (
        "legal winner thank year wave sausage worth useful legal winner thank yellow",
        "2e8905819b8723fe2c1d161860e5ee1830318dbf49a83bd451cfb8440c28bd6fa457fe1296106559a3c80937a1c1069be3a3a5bd381ee6260e8d9739fce1f607"
      ),
      (
        "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
        "d71de856f81a8acc65e6fc851a38d4d7ec216fd0796d0a6827a3ad6ed5511a30fa280f12eb2e47ed2ac03b5c462a0358d18d69fe4f985ec81778c1b370b652a8"
      ),
    ]

    for vector in seedVectors {
      var mnemonicData = vector.mnemonic.data(using: .utf8)!
      defer { BIP39.zero(&mnemonicData) }
      var seed = try BIP39.mnemonicToSeed(mnemonicData, passphrase: "TREZOR")
      defer { BIP39.zero(&seed) }
      XCTAssertEqual(Self.hex(from: seed), vector.seedHex)
    }
  }

  // MARK: - Helpers

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

  private static func hex(from data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
  }
}

extension BIP39Error: Equatable {
  public static func == (lhs: BIP39Error, rhs: BIP39Error) -> Bool {
    switch (lhs, rhs) {
    case (.invalidEntropyLength, .invalidEntropyLength),
         (.checksumFailed, .checksumFailed),
         (.unknownWord, .unknownWord),
         (.invalidWordCount, .invalidWordCount),
         (.invalidMnemonic, .invalidMnemonic):
      return true
    case let (.randomBytesFailed(a), .randomBytesFailed(b)):
      return a == b
    default:
      return false
    }
  }
}
