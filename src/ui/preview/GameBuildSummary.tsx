import type { GameBuildStatus } from '../../contracts/game-build-status';
import { useDocumentLinks } from '../DocumentLinksContext';
import { documentLinkHref } from '../../document-links';

const labels = {
  unchanged: '제작 당시 내용과 같음',
  changed: '제작 후 내용이 바뀜',
  missing: '문서를 찾을 수 없음',
  replaced: '다른 문서로 바뀜',
  unknown: '이전 내용과 비교할 정보 없음',
};
/** Facts about saved input files, never an automatic judgement that a requirement was implemented. */
export function GameBuildSummary({
  build,
  imported = false,
}: {
  build?: GameBuildStatus;
  imported?: boolean;
}) {
  const links = useDocumentLinks();
  return (
    <details className="game-build-summary nodrag nowheel">
      <summary>
        {build?.kind === 'source'
          ? '수정용 원본 보관됨'
          : build?.kind === 'unavailable'
            ? '수정용 원본 확인 필요'
            : imported
              ? '불러온 HTML · 새 버전으로 수정'
              : 'HTML에서 새 수정 원본 작성'}
      </summary>
      {build?.kind === 'source' ? (
        <p>
          기존 소스와 이미지 연결을 이어서 수정합니다. 사용한 라이브러리 버전은
          유지합니다.
        </p>
      ) : build?.kind === 'unavailable' ? (
        <p>
          보관된 수정용 원본을 읽지 못했습니다. 프로젝트나 이전 기록에서 원본을
          복원한 뒤 다시 확인해주세요.
        </p>
      ) : (
        <p>
          HTML만으로는 원래 소스 구조와 기획 문서를 복원할 수 없습니다. AI가
          HTML을 참고해 새 수정용 원본을 작성합니다.
        </p>
      )}
      {imported && (
        <p>
          가져온 파일은 보존합니다. 게임 만들기에서 새 게임으로 만들기를
          선택하고 이 HTML을 참고 자료로 사용하세요.
        </p>
      )}
      {build?.message && <p role="alert">{build.message}</p>}
      {!!build?.libraries.length && (
        <p>
          사용한 라이브러리:{' '}
          {build.libraries.map((l) => `${l.name} ${l.version}`).join(', ')}
        </p>
      )}
      {!!build?.documents.length && (
        <>
          <strong>제작에 사용한 문서</strong>
          <ul>
            {build.documents.slice(0, 20).map((d) => {
              const doc = links.documents.find(
                (doc) => doc.relativePath === d.path,
              );
              let href = '';
              try {
                if (doc) href = documentLinkHref(doc);
              } catch {
                /* Legacy identities remain visible without navigation. */
              }
              return (
                <li key={d.path}>
                  {href && !['missing', 'replaced'].includes(d.state) ? (
                    <button type="button" onClick={() => links.open(href)}>
                      {d.title}
                    </button>
                  ) : (
                    <span>{d.title}</span>
                  )}{' '}
                  · {labels[d.state]}
                </li>
              );
            })}
          </ul>
          {build.documents.length > 20 && (
            <p>그 외 {build.documents.length - 20}개 문서</p>
          )}
          <p>
            문서 변경은 파일 비교 결과입니다. 게임에 반영됐는지 자동으로
            판단하지 않습니다. 수정한 문서는 다음 제작 요청에서 확인하세요.
          </p>
        </>
      )}
      <p>
        HTML 내보내기는 플레이용 파일 하나를 저장합니다. 수정용 원본·기준 문서를
        계속 보관하려면 프로젝트도 유지하세요. 앱의 온라인 멀티 기능은 외부
        HTML에서 제공되지 않습니다.
      </p>
    </details>
  );
}
