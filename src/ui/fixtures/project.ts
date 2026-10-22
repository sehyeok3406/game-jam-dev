import type { CanvasDocument } from '../../contracts/documents';
import type { CanvasSection } from '../../contracts/canvas';
import type { PreviewResult } from '../../contracts/preview';

/** Fresh illustrative data for each sandbox; no product storage or global state. */
export function createProjectFixture(now = Date.now()) {
  const documents: CanvasDocument[] = [
    {
      id: 'raw-loop-note',
      title: '밤이 되면 달라지는 농장',
      type: 'idea',
      status: 'raw',
      relativePath: 'ideas/night-farm.md',
      body: '낮에는 농작물을 키우고, 밤에는 울타리와 자동 장치를 배치한다.\n\n플레이어가 직접 모든 일을 하지 않아도 농장이 움직이면 좋겠다.',
      x: 80,
      y: 100,
      width: 350,
      height: 360,
      collapsed: false,
      sources: [],
      modifiedAt: now,
    },
    {
      id: 'automation-note',
      title: '자동화 아이디어',
      type: 'idea',
      status: 'raw',
      relativePath: 'ideas/automation.md',
      body: '- 작물을 옮기는 컨베이어\n- 조건에 따라 작동하는 장치\n- 멀리서 농장 상태 확인',
      x: 500,
      y: 330,
      width: 330,
      height: 300,
      collapsed: false,
      sources: [],
      modifiedAt: now,
    },
    {
      id: 'core-loop',
      title: '핵심 게임 루프',
      type: 'system',
      status: 'draft',
      relativePath: 'docs/core-loop.md',
      body: '## 플레이 흐름\n\n1. 낮에 씨앗을 선택하고 심는다.\n2. 수확물로 자동화 장치를 해금한다.\n3. 밤에 장치의 효율을 관찰하고 배치를 개선한다.',
      x: 910,
      y: 100,
      width: 390,
      height: 420,
      collapsed: false,
      sources: [
        {
          id: 'raw-loop-note',
          contribution: '낮과 밤의 역할 구분',
        },
        {
          id: 'automation-note',
          contribution: '자동화 장치와 관찰 요소',
        },
      ],
      modifiedAt: now,
    },
  ];

  const sections: CanvasSection[] = [
    {
      id: 'section-farm-automation',
      title: '농장 자동화 아이디어',
      relativePath: 'sections/section-farm-automation.md',
      x: 40,
      y: 60,
      width: 830,
      height: 630,
      members: [
        { id: 'raw-loop-note', path: 'ideas/night-farm.md' },
        { id: 'automation-note', path: 'ideas/automation.md' },
      ],
      modifiedAt: now,
    },
  ];

  const initialPreview: PreviewResult = {
    exists: true,
    relativePath: 'output/index.html',
    content: `<!doctype html><html><body style="margin:0;background:#102016;color:#eff7e9;font-family:system-ui;display:grid;place-items:center;min-height:100vh"><main style="text-align:center"><div style="font-size:64px">🌱</div><h1>자동 농장 프로토타입</h1><p>낮 3일차 · 순무 12개 수확</p><button style="padding:12px 20px;border:0;border-radius:999px;background:#d8ff72;font-weight:700">다음 날</button></main><script>let day=3;document.querySelector('button').onclick=()=>{document.querySelector('p').textContent='낮 '+(++day)+'일차 · 순무 12개 수확';};</script></body></html>`,
  };
  const previews: PreviewResult[] = [initialPreview];
  return { documents, sections, previews, initialPreview };
}
