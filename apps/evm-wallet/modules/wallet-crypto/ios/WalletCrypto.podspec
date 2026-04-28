Pod::Spec.new do |s|
  s.name           = 'WalletCrypto'
  s.version        = '1.0.0'
  s.summary        = 'Native Swift crypto primitives for the wallet (BIP39 + Keychain).'
  s.description    = <<-DESC
    Handles BIP39 mnemonic generation and per-wallet Keychain storage in
    Swift, so secrets are never generated in the JS runtime. See
    modules/wallet-crypto/README.md for the security boundary.
  DESC
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1',
    :tvos => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  # Only the module source files. The `Tests/` directory contains XCTest
  # vectors and must be excluded from the app build; add them to a
  # dedicated test target manually (see modules/wallet-crypto/README.md).
  s.source_files       = "*.{h,m,mm,swift,hpp,cpp}"
  s.exclude_files      = "Tests/**/*"
end
