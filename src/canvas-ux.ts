export type Shortcut =
  | 'import'
  | 'select'
  | 'hand'
  | 'note'
  | 'search'
  | 'navigator'
  | 'help'
  | 'all'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'section'
  | 'delete'
  | 'minimize'
  | 'undo'
  | 'redo'
  | 'fit'
  | 'selection-fit'
  | 'zoom-in'
  | 'zoom-out'
  | 'organize'
  | 'implement'
  | 'save'
  | 'history'
  | 'ui'
  | 'pan';
export function canvasShortcut(
  event: {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    repeat?: boolean;
  },
  scope: { editable?: boolean; dialog?: boolean; playing?: boolean },
): Shortcut | null {
  if (scope.editable || scope.dialog || scope.playing || event.altKey)
    return null;
  const key = event.key.toLowerCase(),
    command = event.ctrlKey || event.metaKey;
  if (event.repeat && !['+', '=', '-', ' '].includes(key)) return null;
  if (command) {
    if (key === 'i') return 'import';
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (key === 'y') return 'redo';
    if (key === 'k') return 'search';
    if (key === 's') return 'save';
    if (key === 'enter') return event.shiftKey ? 'implement' : 'organize';
    if (key === 'm' && event.shiftKey) return 'minimize';
    if (key === 'h' && event.shiftKey) return 'history';
    if (key === '\\') return 'ui';
    if (key === 'g') return 'section';
    return (
      (
        { a: 'all', c: 'copy', v: 'paste', d: 'duplicate' } as Record<
          string,
          Shortcut
        >
      )[key] ?? null
    );
  }
  if (key === '?' || (key === '/' && event.shiftKey)) return 'help';
  if (key === '!' || (key === '1' && event.shiftKey)) return 'fit';
  if (key === '@' || (key === '2' && event.shiftKey)) return 'selection-fit';
  if (key === '+' || key === '=') return 'zoom-in';
  if (key === '-') return 'zoom-out';
  if (key === ' ' && !event.repeat) return 'pan';
  if (key === 's' && event.shiftKey) return 'section';
  return (
    (
      {
        v: 'select',
        h: 'hand',
        n: 'note',
        f: 'search',
        l: 'navigator',
        delete: 'delete',
        backspace: 'delete',
      } as Record<string, Shortcut>
    )[key] ?? null
  );
}

export const SHORTCUTS = [
  ['Markdown · 이미지 불러오기', 'Ctrl + I'],
  ['선택 추가 / 선택 해제', 'Shift 또는 Ctrl + 클릭'],
  ['선택 / 이동 / 새 메모', 'V / H / N'],
  ['새 메모 크기 지정', 'N → 캔버스 드래그'],
  ['잠시 캔버스 이동', 'Space 누른 채 드래그'],
  ['검색 · 명령', 'Ctrl + K 또는 F'],
  ['문서 목록', 'L'],
  ['전체 선택', 'Ctrl + A'],
  ['복사 / 붙여넣기 / 복제', 'Ctrl + C / V / D'],
  ['선택 파일로 섹션 만들기', 'Ctrl + G 또는 Shift + S'],
  ['삭제 확인', 'Delete'],
  ['최소화 / 펼치기', 'Ctrl + Shift + M'],
  ['실행 취소', 'Ctrl + Z'],
  ['다시 실행', 'Ctrl + Shift + Z 또는 Ctrl + Y'],
  ['편집 내용 저장', 'Ctrl + S'],
  ['gamejam! / HTML만 선택해 열기', 'Ctrl + Enter / Ctrl + Shift + Enter'],
  ['전체 / 선택 항목 화면 맞춤', 'Shift + 1 / Shift + 2'],
  ['확대 / 축소', '+ / −'],
  ['히스토리', 'Ctrl + Shift + H'],
  ['상단 UI 숨김 / 복원', 'Ctrl + \\'],
  ['메모 편집 완료', 'Ctrl + Enter (편집기 안)'],
  ['단축키 도움말', '?'],
];

export function markdownEdit(
  body: string,
  start: number,
  end: number,
  action:
    | 'heading'
    | 'bold'
    | 'italic'
    | 'strike'
    | 'list'
    | 'ordered'
    | 'quote'
    | 'rule'
    | 'check'
    | 'table'
    | 'code',
) {
  const selected = body.slice(start, end),
    before = body.slice(0, start),
    after = body.slice(end);
  let text = selected;
  if (action === 'bold') text = `**${selected || '강조할 글'}**`;
  if (action === 'italic') text = `*${selected || '기울일 글'}*`;
  if (action === 'strike') text = `~~${selected || '취소할 글'}~~`;
  if (action === 'rule') text = '\n\n---\n\n';
  if (action === 'ordered' || action === 'quote')
    text = `\n${(selected || '내용')
      .split('\n')
      .map(
        (line, index) =>
          `${action === 'ordered' ? `${index + 1}.` : '>'} ${line}`,
      )
      .join('\n')}`;
  if (action === 'code') text = `\n\n\`\`\`\n${selected || '코드'}\n\`\`\`\n\n`;
  if (action === 'table')
    text = `\n\n| 항목 | 내용 |\n| --- | --- |\n| ${selected || '항목'} | 내용 |\n\n`;
  if (['heading', 'list', 'check'].includes(action)) {
    const prefix = { heading: '## ', list: '- ', check: '- [ ] ' }[
      action as 'heading' | 'list' | 'check'
    ];
    text = `${start && !before.endsWith('\n') ? '\n' : ''}${(selected || '내용')
      .split('\n')
      .map((line) => prefix + line)
      .join('\n')}`;
  }
  return { body: before + text + after, start, end: start + text.length };
}

export function snapPosition(
  moving: { x: number; y: number; width: number; height: number },
  others: { x: number; y: number; width: number; height: number }[],
  tolerance: number,
) {
  const xPoints = [
    moving.x,
    moving.x + moving.width / 2,
    moving.x + moving.width,
  ];
  const yPoints = [
    moving.y,
    moving.y + moving.height / 2,
    moving.y + moving.height,
  ];
  let dx = tolerance + 1,
    dy = tolerance + 1,
    xGuide: number | undefined,
    yGuide: number | undefined;
  for (const item of others) {
    for (const target of [item.x, item.x + item.width / 2, item.x + item.width])
      for (const point of xPoints) {
        if (
          Math.abs(target - point) <= tolerance &&
          Math.abs(target - point) < Math.abs(dx)
        ) {
          dx = target - point;
          xGuide = target;
        }
      }
    for (const target of [
      item.y,
      item.y + item.height / 2,
      item.y + item.height,
    ])
      for (const point of yPoints) {
        if (
          Math.abs(target - point) <= tolerance &&
          Math.abs(target - point) < Math.abs(dy)
        ) {
          dy = target - point;
          yGuide = target;
        }
      }
  }
  return {
    x: moving.x + (xGuide === undefined ? 0 : dx),
    y: moving.y + (yGuide === undefined ? 0 : dy),
    xGuide,
    yGuide,
  };
}
