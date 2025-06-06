export default [
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      semi: ["error", "always"],
      quotes: ["error", "double"],
    },
    ignores: ["node_modules/**", "out/**", "broadcast/**", "bytecode/**"],
  },
];
