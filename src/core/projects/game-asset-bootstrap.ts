import { GAME_ASSET_BOOTSTRAP } from '../../contracts/game-build-execution.ts';

export function bindGameAssets(html: string, urls: Record<string, string>) {
  const index = html.indexOf(GAME_ASSET_BOOTSTRAP);
  if (index < 0) throw Error('게임 에셋 초기화 정보를 찾을 수 없습니다.');
  const data = JSON.stringify(JSON.stringify(urls)).replaceAll('<', '\\u003c');
  return (
    html.slice(0, index) +
    `<script>globalThis.__GAMEJAM_PROJECT_ASSETS_V1__=Object.freeze(JSON.parse(${data}));</script>` +
    html.slice(index + GAME_ASSET_BOOTSTRAP.length)
  );
}
