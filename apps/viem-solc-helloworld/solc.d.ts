declare module "solc" {
  interface SolcFunction {
    (input: string): string;
    compile(input: string): string;
    version(): string;
    setupMethods(soljson: any): any;
    loadRemoteVersion(version: string, callback: (err: Error | null, solc: any) => void): void;
  }

  const solc: SolcFunction;
  export default solc;
}
