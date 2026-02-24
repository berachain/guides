/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PRIVATE_KEY: string
  readonly PRIVATE_KEY_GAS_SUBSIDIZER: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
