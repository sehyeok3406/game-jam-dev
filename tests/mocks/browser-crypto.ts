/** Browser-only API fixtures use Web Crypto IDs; real file hashing stays in native/server tests. */
export const randomUUID = () => globalThis.crypto.randomUUID();
export function createHash(): never {
  throw Error(
    '이 브라우저 UI fixture에서는 Node 파일 해시를 실행하지 않습니다.',
  );
}
