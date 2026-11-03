/** Storage negotiation only. This does not certify workflow v2 or a build runtime. */
export async function requireGameBuildStorageSupport(serverUrl: string) {
  const response = await fetch(new URL('/health', serverUrl), {
    redirect: 'error',
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.gameBuildStorageVersion !== 1)
    throw Error(
      '게임 제작 원본을 보관할 수 있는 협업 서버로 업데이트해주세요.',
    );
}
