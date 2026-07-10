/** minimal typings for untyped parser deps (docparse.ts); pdf-parse 2.x ships its own */
declare module 'mammoth' {
  export function extractRawText(input: {
    path?: string;
    buffer?: Buffer;
  }): Promise<{ value: string }>;
}
