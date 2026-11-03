import { deflateSync } from 'node:zlib';
const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (name, data) => {
  const tag = Buffer.from(name),
    length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([length, tag, data, crc]);
};
function png(size, pixel) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      Buffer.from(pixel(x, y)).copy(raw, y * (1 + size * 4) + 1 + x * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
// Deliberately small code-drawn test assets, not AI-generated final game art.
export const catPng = png(32, (x, y) => {
  const inside =
    (x >= 7 && x <= 24 && y >= 9 && y <= 26) ||
    (y >= 4 && y < 10 && ((x >= 7 && x <= 12) || (x >= 19 && x <= 24)));
  if (!inside) return [0, 0, 0, 0];
  if ((y === 15 || y === 16) && (x === 12 || x === 20))
    return [35, 27, 55, 255];
  if (y === 20 && x >= 15 && x <= 17) return [224, 116, 144, 255];
  if (y >= 25) return [119, 98, 165, 255];
  return [255, 214, 153, 255];
});
export const forestPng = png(64, (x, y) => {
  const trunk =
    (x >= 12 && x <= 16 && y > 25) || (x >= 48 && x <= 52 && y > 35);
  const leaf =
    (x - 14) ** 2 / 144 + (y - 20) ** 2 / 196 < 1 ||
    (x - 50) ** 2 / 160 + (y - 28) ** 2 / 260 < 1;
  if (trunk) return [78, 63, 82, 255];
  if (leaf) return (x + y) % 5 === 0 ? [88, 133, 124, 255] : [43, 89, 91, 255];
  return (x * 7 + y * 11) % 41 === 0 ? [211, 214, 150, 255] : [24, 47, 69, 255];
});
export const pixelBrief = `# 달빛 우체부
전투 없이 편지를 모아 배달하는 작은 픽셀 아트 게임. 대시보드나 설명 페이지가 아닌 게임 화면을 만든다.
5×5 격자에서 시작 위치는 (0,0), 편지 3개는 (1,0),(2,0),(2,1), 우체통은 (3,1), 물웅덩이는 (0,1)이다. 나머지는 이동 가능하다.
Enter 또는 시작 버튼으로 시작. 방향키/WASD를 한 번 누르면 한 칸 이동한다. 좌표는 오른쪽이 x+, 아래가 y+다. 격자 밖으로 나가지 않는다.
초기 목숨 3개. 물웅덩이에 닿으면 목숨 1개 감소, 시작 위치로 돌아오고 1초 동안 추가 피해를 받지 않는다. 목숨 0이면 실패. R 또는 재시작 버튼으로 처음 상태.
편지 3개를 모두 모은 상태로 우체통에 도착하면 “배달 완료”와 재시작을 표시한다. 수집 피드백과 피해/무적 표시가 명확해야 한다.
제공한 cat.png를 플레이어로, forest.png를 게임 배경 또는 숲 타일에 실제 사용한다. Canvas2D와 내장 CSS로 충분하므로 이 게임은 외부 라이브러리가 필요 없다.
달빛 남색/청록 숲과 따뜻한 크림색 고양이, 픽셀 격자, 간단한 목숨·편지 HUD. 설명 카드나 통계 차트를 주 화면에 두지 않는다.
별도 서버, 외부 URL, 음원, 이미지 검색/생성은 사용하지 않는다. visible status/HUD는 읽을 수 있는 HTML 텍스트로도 제공해 키보드 사용자에게 결과를 알린다.`;
export const neonBrief = `# 네온 신호 정렬
Three.js를 실제 렌더링에 사용하는 3D 네온 퍼즐 게임. three@0.187.0을 준비하고 JS의 import로 사용한다.
어두운 보랏빛 공간에 입체적인 발광 큐브 3개와 바닥 격자, 원근 카메라, 빛과 반사 느낌을 구성한다. 앞선 픽셀 숲과 다른 형태/색/시점을 사용한다.
Enter 또는 시작 버튼으로 시작. 숫자 1,2,3 키 또는 대응 버튼으로 각각의 큐브를 주황/청록 두 상태 사이에서 전환한다.
초기 상태는 [주황,주황,주황], 목표는 [청록,주황,청록]. 1 키 다음 3 키를 누르면 승리한다. 바뀐 횟수를 표시한다.
승리하면 “신호 연결 완료”와 재시작 버튼. R 키는 초기 상태·횟수 0으로 복원한다. 목표 패턴과 현재 상태는 색과 글자로 모두 알려준다.
게임 화면 중심 구성, 절제된 HUD와 빛 피드백. 사용자 정의 shader/eval/worker/WASM/WebGPU, 외부 리소스와 서버는 사용하지 않는다.
현재 gamejam 준비/builder 계약 안에서 Three.js WebGLRenderer, Scene, PerspectiveCamera, 기본 geometry/material/light로 실제 3D 화면을 만든다. visible status/HUD는 읽을 수 있는 HTML 텍스트도 제공한다.`;
