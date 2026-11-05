import { newGameUiItem } from '../../src/game-ui-model.ts';

// Stable inputs shared by both renderer variants and the packaged project.
export function mixedCanvasFixture(
  count: number,
  sample: Record<string, unknown>,
) {
  const documents: any[] = [],
    drawings: any[] = [],
    frames: any[] = [],
    previews: any[] = [],
    windows: Record<string, any> = {};
  const uuid = (namespace: number, index: number) =>
    `${namespace.toString(16).padStart(8, '0')}-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`;
  const body =
    '## 혼합 캔버스 문서\n\n' +
    Array.from(
      { length: 10 },
      (_, i) =>
        `### ${i + 1}. 전투와 보상\n\n- 플레이어의 **선택**과 피드백\n- [ ] 확인할 항목\n\n탐색·전투·보상 흐름을 점검합니다.\n\n| 항목 | 값 |\n| --- | --- |\n| 체력 | 100 |\n`,
    ).join('\n');
  for (let i = 0; i < count; i++) {
    const slot = i % 20,
      pos = { x: (i % 16) * 460, y: Math.floor(i / 16) * 380 };
    if (slot < 8 || slot === 16 || slot === 17) {
      const image = slot >= 16;
      documents.push({
        ...sample,
        id: `mixed-${i}`,
        relativePath: `docs/mixed-${i}.md`,
        title: `혼합 ${i}`,
        canvasId: 'default',
        type: image ? 'image' : 'idea',
        ...pos,
        width: 420,
        height: 330,
        collapsed: false,
        body: image ? '혼합 이미지 참고' : body,
        sources: [],
        asset: image
          ? {
              path: `assets/images/mixed-${i}.png`,
              originalName: `mixed-${i}.png`,
              mime: 'image/png',
              purpose: 'asset',
              bytes: 0,
            }
          : undefined,
      });
    } else if (slot < 16) {
      const kind = slot < 11 ? 'text' : slot < 14 ? 'stroke' : 'shape';
      drawings.push({
        id: uuid(1, i),
        generation: uuid(2, i),
        canvasId: 'default',
        kind,
        transform: {
          ...pos,
          width: kind === 'text' ? 400 : 320,
          height: kind === 'text' ? 240 : 220,
          rotation: 0,
        },
        style: {
          fill: kind === 'shape' ? '#eff2ff' : null,
          stroke: '#6366f1',
          strokeWidth: 2,
          opacity: 1,
          strokePattern: 'solid',
        },
        layer: 'annotation',
        order: i,
        createdAt: 1,
        updatedAt: 1,
        geometry:
          kind === 'shape'
            ? { shape: 'rounded-rectangle', cornerRadius: 12 }
            : kind === 'stroke'
              ? {
                  brush: 'pen',
                  sourceWidth: 320,
                  sourceHeight: 220,
                  points: Array.from({ length: 100 }, (_, j) => [
                    Math.round((j * 32000) / 99) / 100,
                    Math.round((110 + Math.sin(j / 11) * 70) * 100) / 100,
                    0.5,
                  ]),
                  pressureEnabled: false,
                  rendererVersion: 1,
                }
              : {
                  document: JSON.stringify({
                    type: 'doc',
                    content: Array.from({ length: 5 }, (_, j) => ({
                      type: 'paragraph',
                      content: [
                        { type: 'text', text: `혼합 텍스트 ${i} / ${j}` },
                      ],
                    })),
                  }),
                  fontSize: 24,
                  color: '#273142',
                  fontFamily: 'sans-serif',
                  align: 'left',
                },
      });
    } else if (slot === 18) {
      frames.push({
        version: 1,
        id: uuid(3, i),
        generation: uuid(4, i),
        canvasId: 'default',
        title: `혼합 게임 UI ${i}`,
        ...pos,
        width: 420,
        viewportWidth: 1280,
        viewportHeight: 720,
        descriptionPath: null,
        items: Array.from({ length: 20 }, (_, j) => {
          let serial = 0;
          const item = newGameUiItem(
            (['health', 'mana', 'button', 'text', 'skills'] as const)[j % 5],
            () => uuid(5, i * 4096 + j * 128 + serial++),
          );
          return {
            ...item,
            name: `${item.name} ${j + 1}`,
            x: (j % 4) * 300,
            y: Math.floor(j / 4) * 130,
          };
        }),
      });
    } else {
      const relativePath = `output/inbox/game-${i}/v001/index.html`;
      previews.push({
        exists: true,
        title: `혼합 HTML ${i}`,
        sourceId: uuid(6, i),
        canvasId: 'default',
        relativePath,
        content: `<!doctype html><html><body style="margin:0;background:#182638;color:white"><h2>혼합 HTML ${i}</h2><input value="상태 보존"><script>window.bootId=Math.random();window.score=42;</script></body></html>`,
      });
      windows[relativePath] = {
        ...pos,
        width: 420,
        height: 330,
        collapsed: false,
      };
    }
  }
  return {
    documents,
    drawings,
    frames,
    previews,
    windows,
    counts: {
      markdown: documents.filter((d) => d.type !== 'image').length,
      images: documents.filter((d) => d.type === 'image').length,
      text: drawings.filter((d) => d.kind === 'text').length,
      strokes: drawings.filter((d) => d.kind === 'stroke').length,
      shapes: drawings.filter((d) => d.kind === 'shape').length,
      gameUi: frames.length,
      html: previews.length,
    },
  };
}
