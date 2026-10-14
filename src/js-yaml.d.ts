declare module 'js-yaml' {
  const yaml: {
    safeLoad(source: string): unknown;
    safeDump(
      value: unknown,
      options?: { noRefs?: boolean; lineWidth?: number },
    ): string;
  };
  export default yaml;
}
