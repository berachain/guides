declare module "solc" {
  function compile(input: string): string;
  export = compile;
}
