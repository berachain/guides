const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// viem/ox pull in Noble packages that still rely on file-based subpath
// resolution in React Native. Metro's package-exports resolver falls back to
// the right files, but logs noisy warnings for @noble/hashes/crypto.js.
config.resolver.unstable_enablePackageExports = false;

module.exports = withNativeWind(config, { input: './global.css' });
