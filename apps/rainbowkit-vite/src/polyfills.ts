// Polyfills for browser environment
window.global = window.global ?? window;
window.Buffer = window.Buffer ?? (() => {
  const buffer = require('buffer');
  return buffer.Buffer;
})();
window.process = window.process ?? { env: {} }; // Minimal process polyfill

export {};
