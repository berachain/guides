import CommonCrypto
import CryptoKit
import Foundation
import Security

enum BIP39Error: Error {
  case invalidEntropyLength
  case checksumFailed
  case unknownWord
  case invalidWordCount
  case invalidMnemonic
  case randomBytesFailed(OSStatus)
}

/// The result of a successful mnemonic generation. The raw entropy is owned
/// by the `cleanup` closure; callers MUST invoke `cleanup()` in a `defer`
/// block to zero the entropy buffer.
struct GeneratedMnemonic {
  let words: [String]
  let cleanup: () -> Void
}

enum BIP39 {
  private static let validEntropyBits: Set<Int> = [128, 160, 192, 224, 256]
  private static let validWordCounts: Set<Int> = [12, 15, 18, 21, 24]

  // MARK: - Generation

  /// Generates a fresh BIP39 mnemonic using `SecRandomCopyBytes` for entropy.
  /// The entropy buffer is allocated inside this function and zeroed only
  /// when the returned `cleanup` closure is invoked.
  static func generateMnemonic(entropyBits: Int = 256) throws -> GeneratedMnemonic {
    guard validEntropyBits.contains(entropyBits) else {
      throw BIP39Error.invalidEntropyLength
    }
    let byteCount = entropyBits / 8
    var entropy = Data(count: byteCount)
    let status = entropy.withUnsafeMutableBytes { ptr -> OSStatus in
      guard let base = ptr.baseAddress else { return errSecAllocate }
      return SecRandomCopyBytes(kSecRandomDefault, byteCount, base)
    }
    if status != errSecSuccess {
      zero(&entropy)
      throw BIP39Error.randomBytesFailed(status)
    }
    let words = try mnemonicFromEntropy(entropy)
    // The closure captures `entropy` by reference (heap box). When the
    // caller invokes `cleanup()` in a `defer`, refcount on entropy's
    // backing buffer is 1 (the interior copy inside `mnemonicFromEntropy`
    // has been released), so `withUnsafeMutableBytes` mutates in place
    // and `memset_s` zeroes the actual allocation.
    let cleanup: () -> Void = {
      zero(&entropy)
    }
    return GeneratedMnemonic(words: words, cleanup: cleanup)
  }

  /// Deterministically converts raw entropy into a BIP39 word sequence.
  /// Exposed for unit tests (known-answer vectors).
  static func mnemonicFromEntropy(_ entropy: Data) throws -> [String] {
    guard validEntropyBits.contains(entropy.count * 8) else {
      throw BIP39Error.invalidEntropyLength
    }
    let entropyBits = entropy.count * 8
    let checksumBits = entropyBits / 32
    let hash = Data(SHA256.hash(data: entropy))

    // Concatenate entropy bytes with the MSB of the hash as checksum source.
    // At most 8 checksum bits are ever needed (256-bit entropy case),
    // so appending a single hash byte is always sufficient.
    var buffer = Data(entropy)
    buffer.append(hash[0])
    defer { zero(&buffer) }

    let totalBits = entropyBits + checksumBits
    var indices: [Int] = []
    indices.reserveCapacity(totalBits / 11)
    var cursor = 0
    while cursor < totalBits {
      indices.append(readBits(buffer, startBit: cursor, count: 11))
      cursor += 11
    }
    return indices.map { BIP39Wordlist.words[$0] }
  }

  static func mnemonicToString(_ words: [String]) -> String {
    words.joined(separator: " ")
  }

  // MARK: - Validation

  /// Validates a BIP39 mnemonic string: word count, membership in the wordlist,
  /// and checksum. Returns `true` on success; throws otherwise.
  @discardableResult
  static func validate(mnemonic: String) throws -> Bool {
    let words = mnemonic
      .split(separator: " ", omittingEmptySubsequences: true)
      .map(String.init)
    guard validWordCounts.contains(words.count) else {
      throw BIP39Error.invalidWordCount
    }
    var indices: [Int] = []
    indices.reserveCapacity(words.count)
    for word in words {
      guard let idx = BIP39Wordlist.index(of: word) else {
        throw BIP39Error.unknownWord
      }
      indices.append(idx)
    }
    let totalBits = words.count * 11
    let checksumBits = totalBits / 33
    let entropyBits = totalBits - checksumBits
    let bufferByteCount = (totalBits + 7) / 8

    // Reconstruct the bit buffer MSB-first.
    var bitBuffer = Data(count: bufferByteCount)
    defer { zero(&bitBuffer) }
    var pos = 0
    for idx in indices {
      for bitIndex in 0..<11 {
        let bit = UInt8((idx >> (10 - bitIndex)) & 1)
        bitBuffer[pos / 8] |= bit << UInt8(7 - (pos % 8))
        pos += 1
      }
    }

    let entropyByteCount = entropyBits / 8
    var entropy = Data(bitBuffer.prefix(entropyByteCount))
    defer { zero(&entropy) }
    let hash = Data(SHA256.hash(data: entropy))

    let actual = readBits(bitBuffer, startBit: entropyBits, count: checksumBits)
    let expected = readBits(hash, startBit: 0, count: checksumBits)
    if actual != expected {
      throw BIP39Error.checksumFailed
    }
    return true
  }

  // MARK: - Seed derivation

  /// Derives the 64-byte BIP39 seed using PBKDF2-HMAC-SHA512.
  ///
  /// Password: mnemonic UTF-8 bytes. Salt: `"mnemonic" + passphrase` UTF-8
  /// bytes. Iterations: 2048. The caller owns and must zero the returned
  /// buffer as soon as possible.
  static func mnemonicToSeed(_ mnemonic: Data, passphrase: String = "") throws -> Data {
    guard let mnemonicString = String(data: mnemonic, encoding: .utf8) else {
      throw BIP39Error.invalidMnemonic
    }
    do {
      try validate(mnemonic: mnemonicString)
    } catch {
      throw BIP39Error.invalidMnemonic
    }

    guard let salt = "mnemonic\(passphrase)".data(using: .utf8) else {
      throw BIP39Error.invalidMnemonic
    }

    let seedLength = 64
    var seed = Data(count: seedLength)
    let mnemonicLength = mnemonic.count
    let saltLength = salt.count
    let status = mnemonic.withUnsafeBytes { mnemonicPtr in
      salt.withUnsafeBytes { saltPtr in
        seed.withUnsafeMutableBytes { seedPtr in
          CCKeyDerivationPBKDF(
            CCPBKDFAlgorithm(kCCPBKDF2),
            mnemonicPtr.bindMemory(to: Int8.self).baseAddress,
            mnemonicLength,
            saltPtr.bindMemory(to: UInt8.self).baseAddress,
            saltLength,
            CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA512),
            2048,
            seedPtr.bindMemory(to: UInt8.self).baseAddress,
            seedLength
          )
        }
      }
    }
    guard status == kCCSuccess else {
      zero(&seed)
      throw BIP39Error.invalidMnemonic
    }
    return seed
  }

  // MARK: - Bit helpers

  /// Reads `count` bits from `buffer` starting at bit index `startBit`,
  /// MSB-first. Returns the bits packed into the low bits of an Int.
  private static func readBits(_ buffer: Data, startBit: Int, count: Int) -> Int {
    var result = 0
    for i in 0..<count {
      let pos = startBit + i
      let byte = buffer[pos / 8]
      let bit = (Int(byte) >> (7 - (pos % 8))) & 1
      result = (result << 1) | bit
    }
    return result
  }

  // MARK: - Memory hygiene

  /// Zeroes the given `Data` buffer in place using `memset_s`.
  static func zero(_ data: inout Data) {
    data.withUnsafeMutableBytes { ptr in
      guard let base = ptr.baseAddress, ptr.count > 0 else { return }
      memset_s(base, ptr.count, 0, ptr.count)
    }
  }
}
