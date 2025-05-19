/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ["@berachain/eslint-config/react-internal.js"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "./tsconfig.eslint.json",
  },
};
