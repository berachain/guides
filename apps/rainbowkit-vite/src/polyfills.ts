import { Buffer } from "buffer";

const globalWindow = window as Window &
  typeof globalThis & {
    Buffer?: typeof Buffer;
    global?: typeof globalThis;
    process?: { env: Record<string, string> };
  };

globalWindow.global = globalWindow.global ?? globalThis;
globalWindow.Buffer = globalWindow.Buffer ?? Buffer;
globalWindow.process = globalWindow.process ?? { env: {} };

export {};
