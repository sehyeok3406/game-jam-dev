import { Check, Eye } from 'lucide-react';
import { GAMEJAM_PAGES, type GamejamPage } from '../gamejam-wizard';
import type { GamejamRequest } from '../gamejam-request';

export function GamejamProgress({
  page,
  visited,
  busy,
  navigate,
}: {
  page: GamejamPage;
  visited: number;
  busy: boolean;
  navigate: (page: GamejamPage) => void;
}) {
  return (
    <nav className="gamejam-progress" aria-label="gamejam! 설정 단계">
      <ol>
        {GAMEJAM_PAGES.map((step) => (
          <li key={step.number}>
            <button
              type="button"
              data-gamejam-step={step.number}
              aria-current={page === step.number ? 'step' : undefined}
              disabled={busy || step.number > visited}
              onClick={() => navigate(step.number)}
            >
              <span className="gamejam-progress-number">
                {step.number < page ? <Check size={13} /> : step.number}
              </span>
              <span>{step.label}</span>
              {step.number === 4 && <Eye size={12} aria-label="미리보기" />}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function GamejamReview({
  request,
  busy,
  navigate,
  nameForPath = (path) =>
    path
      .split('/')
      .at(-1)
      ?.replace(/\.[^.]+$/, '') || '이름 없는 자료',
  documentName = '선택한 문서',
  canvasName,
}: {
  request: GamejamRequest;
  nameForPath?: (path: string) => string;
  documentName?: string;
  canvasName?: string;
  busy: boolean;
  navigate: (page: GamejamPage) => void;
}) {
  return (
    <div className="gamejam-review">
      <p>입력 자료와 설정을 확인한 뒤 실행하세요.</p>
      <section>
        <div className="gamejam-review-heading">
          <strong>작업과 자료</strong>
          <button type="button" disabled={busy} onClick={() => navigate(1)}>
            수정
          </button>
        </div>
        <p>
          {request.organize && request.implement
            ? '문서 정리 → 게임 만들기'
            : request.organize
              ? '문서 정리'
              : request.implement
                ? '게임 만들기'
                : '선택한 작업 없음'}
        </p>
        <ul className="gamejam-review-inputs">
          {request.inputPaths.map((path) => (
            <li key={path}>{nameForPath(path)}</li>
          ))}
        </ul>
        {!request.inputPaths.length && <p>선택한 입력 자료가 없습니다.</p>}
      </section>
      <section>
        <div className="gamejam-review-heading">
          <strong>결과 설정</strong>
          <button type="button" disabled={busy} onClick={() => navigate(2)}>
            수정
          </button>
        </div>
        <dl>
          {canvasName && (
            <>
              <dt>결과를 놓을 캔버스</dt>
              <dd>{canvasName}</dd>
            </>
          )}
          <dt>이름</dt>
          <dd>{request.resultName.trim() || '기본 이름 사용'}</dd>
          {request.organize && (
            <>
              <dt>문서</dt>
              <dd>
                {request.documentResult?.mode === 'update'
                  ? `기존 문서 수정 · ${documentName}`
                  : '새 문서 만들기'}
                {request.documentResult?.structure === 'custom' && (
                  <ul>
                    {request.documentResult.documents?.map((doc) => (
                      <li key={doc.key}>
                        <strong>{doc.title || '제목 미입력'}</strong>
                        {doc.instructions && <span> — {doc.instructions}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {request.documentResult?.structure === 'systems' && (
                  <span> · 게임 개요 + 시스템별 자동 분리</span>
                )}
              </dd>
            </>
          )}
          {request.implement && (
            <>
              <dt>게임</dt>
              <dd>
                {request.htmlResult?.mode === 'update'
                  ? `기존 게임 수정 · ${request.htmlResult.basePath ? nameForPath(request.htmlResult.basePath) : '게임을 선택해주세요'}`
                  : '새 게임 버전 만들기'}
              </dd>
              {request.htmlResult?.mode !== 'update' &&
                request.htmlResult?.basePath && (
                  <>
                    <dt>기준 결과</dt>
                    <dd>{nameForPath(request.htmlResult.basePath)}</dd>
                  </>
                )}
            </>
          )}
        </dl>
      </section>
      <section>
        <div className="gamejam-review-heading">
          <strong>AI에게 요청할 내용</strong>
          <button type="button" disabled={busy} onClick={() => navigate(3)}>
            수정
          </button>
        </div>
        {(['organize', 'implement'] as const)
          .filter((kind) => request[kind])
          .map((kind) => (
            <details key={kind}>
              <summary>
                {kind === 'organize' ? '문서 정리 요청' : '게임 만들기 요청'}
              </summary>
              <pre>{request.instructions[kind]}</pre>
            </details>
          ))}
      </section>
      {request.multiplayer && (
        <section>
          <strong>이번 구현에 포함</strong>
          <p>
            프로젝트 온라인 멀티플레이 · 최대 {request.multiplayer.maxPlayers}명
            · 혼자 연습 지원
            {!request.implement ? ' · 게임 만들기 선택 시 적용' : ''}
          </p>
          <button type="button" disabled={busy} onClick={() => navigate(4)}>
            추가할 기능 수정
          </button>
        </section>
      )}
      {request.multiplayer === null && (
        <p>온라인 멀티플레이 제외 · 다음 게임에 반영</p>
      )}
      <p className="gamejam-preview-notice">
        <Eye size={15} aria-hidden="true" />
        기능 예시의 참고 선택은 이번 작업에 반영되지 않습니다. 적용 모듈은 위
        목록에서 확인하세요.
      </p>
    </div>
  );
}
