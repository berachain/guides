const baseConfig = require("./base");

module.exports = {
  ...baseConfig,
  rules: {
    ...baseConfig.rules,
    // Allow console statements in guides/examples
    "no-console": "off",
  },
}; 