import { useState } from 'react';
import type { PreviewResult } from '../shared';
import {
  RESULT_CATEGORIES,
  resultLocation,
  type ResultCategory,
} from '../preview-output';
import {
  legacyResultMoves,
  moveDestination,
  type MoveResultInput,
} from '../result-folder-plan';

export function ResultFolderDialog({
  preview,
  previews,
  busy,
  onClose,
  onMove,
  onOrganize,
}: {
  preview?: PreviewResult;
  previews: PreviewResult[];
  busy: boolean;
  onClose: () => void;
  onMove: (input: MoveResultInput) => Promise<void>;
  onOrganize: () => Promise<void>;
}) {
  const location = preview
    ? (resultLocation(preview.relativePath) ??
      resultLocation(
        legacyResultMoves({ [preview.relativePath]: preview.content })[0]?.to ??
          '',
      ))
    : undefined;
  const [category, setCategory] = useState<ResultCategory>(
    location?.category ?? 'inbox',
  );
  const [feature, setFeature] = useState(
    location?.feature ?? preview?.title ?? 'untitled',
  );
  const [error, setError] = useState('');
  const files = Object.fromEntries(
    previews.map((item) => [item.relativePath, item.content ?? '']),
  );
  let destination = '';
  try {
    if (preview)
      destination = moveDestination(files, {
        relativePath: preview.relativePath,
        category,
        feature,
      });
  } catch {
    /* field validation on submit */
  }
  const legacy = preview ? [] : legacyResultMoves(files);
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="import-dialog floating-surface"
        role="dialog"
        aria-modal="true"
        aria-label="결과물 폴더 정리"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <h2>{preview ? '폴더 분류·이동' : '기존 결과물 폴더 정리'}</h2>
        <p>
          {preview
            ? 'HTML과 해당 버전의 관련 파일을 함께 옮깁니다. 캔버스 위치와 문서·작업의 참조도 유지합니다.'
            : '기존 결과물을 미분류 → 기능 → 버전 구조로 옮깁니다. 이후 HTML 우클릭에서 분류를 변경할 수 있습니다.'}
        </p>
        {preview ? (
          <>
            <label>
              분류
              <select
                aria-label="결과물 분류"
                value={category}
                disabled={busy}
                onChange={(event) =>
                  setCategory(event.target.value as ResultCategory)
                }
              >
                {Object.entries(RESULT_CATEGORIES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              기능 이름
              <input
                aria-label="결과물 기능 이름"
                value={feature}
                maxLength={80}
                disabled={busy}
                onChange={(event) => setFeature(event.target.value)}
              />
            </label>
            <p>
              <code>{preview.relativePath}</code>
              <br />→ <code>{destination || '기능 이름을 입력해주세요.'}</code>
            </p>
          </>
        ) : (
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            {legacy.length ? (
              legacy.map((move) => (
                <p key={move.from}>
                  <code>{move.from}</code>
                  <br />→ <code>{move.to}</code>
                </p>
              ))
            ) : (
              <p>모든 결과물이 새 폴더 구조를 사용하고 있습니다.</p>
            )}
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="import-dialog-actions">
          <button disabled={busy} onClick={onClose}>
            취소
          </button>
          <button
            className="button-primary"
            disabled={
              busy ||
              (preview
                ? !destination || destination === preview.relativePath
                : !legacy.length)
            }
            onClick={() => {
              setError('');
              void (
                preview
                  ? onMove({
                      relativePath: preview.relativePath,
                      category,
                      feature,
                      revision: preview.revision,
                    })
                  : onOrganize()
              ).catch((reason) =>
                setError(
                  reason instanceof Error ? reason.message : String(reason),
                ),
              );
            }}
          >
            {busy
              ? '이동 중…'
              : preview
                ? '이 폴더로 이동'
                : `${legacy.length}개 결과물 정리`}
          </button>
        </div>
      </section>
    </div>
  );
}
