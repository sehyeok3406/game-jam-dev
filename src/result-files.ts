import { isResultFolderPath } from './preview-output.ts';

/** Support files are confined to an owned version folder, never executables. */
export function isResultAssetPath(value: unknown): value is `output/${string}` {
  if (typeof value !== 'string' || value.length > 240 || value.includes('\\'))
    return false;
  const parts = value.split('/');
  if (
    parts.some(
      (part) =>
        !/^[\p{L}\p{M}\p{N}_.-]+$/u.test(part) ||
        part.startsWith('.') ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  )
    return false;
  const file = parts.at(-1)!;
  if (
    !/\.(css|js|json|txt|svg|png|jpe?g|webp|gif|woff2?|ttf|mp3|ogg|wav)$/i.test(
      file,
    )
  )
    return false;
  for (let count = 3; count < parts.length; count++)
    if (isResultFolderPath(`${parts.slice(0, count).join('/')}/index.html`))
      return true;
  return false;
}
export const OUTPUT_STRUCTURE_README = `# HTML 결과물\n\n분류 → 기능 → 버전 순서로 관리합니다. 각 버전의 index.html을 브라우저에서 열어 확인하세요.\n\n- systems: 게임 규칙·동작\n- ui-ux: 화면·조작·사용 흐름\n- content: 적·퀘스트·스테이지 등 콘텐츠\n- prototypes: 여러 기능이 결합된 플레이 시제품\n- inbox: 아직 분류하지 않은 결과물\n\n예: systems/combat/v001/index.html\n\n관련 CSS·JavaScript·이미지는 해당 버전 폴더 안에 함께 보관합니다. 경로 변경은 앱의 HTML 우클릭 → 폴더 분류·이동을 이용하세요.\n`;
