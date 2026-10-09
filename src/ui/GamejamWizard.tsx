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
}: {
  request: GamejamRequest;
  busy: boolean;
  navigate: (page: GamejamPage) => void;
}) {
  return (
    <div className="gamejam-review">
      <p>입력 자료와 설정을 확인한 뒤 실행하세요.</p>
      <section>
        <div className="gamejam-review-heading">
          <strong>작업·입력</strong>
          <button type="button" disabled={busy} onClick={() => navigate(1)}>
            수정
          </button>
        </div>
        <p>
          {request.organize && request.implement
            ? '문서 정리 → HTML 구현'
            : request.organize
              ? '문서 정리'
              : request.implement
                ? 'HTML 구현'
                : '선택한 작업 없음'}
        </p>
        <ul className="gamejam-review-inputs">
          {request.inputPaths.map((path) => (
            <li key={path}>{path}</li>
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
          <dt>이름</dt>
          <dd>{request.resultName.trim() || '기본 이름 사용'}</dd>
          {request.organize && (
            <>
              <dt>문서</dt>
              <dd>
                {request.documentResult?.mode === 'update'
                  ? `기존 문서 업데이트 · ${request.documentResult.baseDir ?? '묶음 선택 필요'}`
                  : '새 문서 버전 만들기'}
              </dd>
            </>
          )}
          {request.implement && (
            <>
              <dt>HTML</dt>
              <dd>
                {request.htmlResult?.mode === 'update'
                  ? `기존 결과 업데이트 · ${request.htmlResult.basePath ?? 'output/index.html'}`
                  : '새 HTML 버전 만들기'}
              </dd>
              {request.htmlResult?.mode !== 'update' &&
                request.htmlResult?.basePath && (
                  <>
                    <dt>기준 결과</dt>
                    <dd>{request.htmlResult.basePath}</dd>
                  </>
                )}
            </>
          )}
        </dl>
      </section>
      <section>
        <div className="gamejam-review-heading">
          <strong>작업 지침</strong>
          <button type="button" disabled={busy} onClick={() => navigate(3)}>
            수정
          </button>
        </div>
        {(['organize', 'implement'] as const)
          .filter((kind) => request[kind])
          .map((kind) => (
            <details key={kind}>
              <summary>
                {kind === 'organize' ? '문서 정리 지침' : 'HTML 구현 지침'}
              </summary>
              <pre>{request.instructions[kind]}</pre>
            </details>
          ))}
      </section>
      <p className="gamejam-preview-notice">
        <Eye size={15} aria-hidden="true" />
        기능 라이브러리는 미리보기입니다. 살펴본 기능은 이번 작업에 반영되지
        않습니다.
      </p>
    </div>
  );
}
