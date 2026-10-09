import { useState } from 'react';
import { Plus, MoreHorizontal, ArrowLeft, ArrowRight, X } from 'lucide-react';
import type { CanvasSheets, CanvasSheetCommand } from '../shared';
import { previewState } from './debug/uiDebugPreviewState';

export function CanvasTabs({
  sheets,
  active,
  unread,
  readOnly,
  switchTo,
  change,
}: {
  sheets: CanvasSheets;
  active: string;
  unread: Set<string>;
  readOnly: boolean;
  switchTo: (id: string) => Promise<void>;
  change: (command: CanvasSheetCommand) => Promise<void>;
}) {
  const [dialog, setDialog] = useState<{
    action: 'add' | 'manage';
    id: string;
    expected: string | null;
  } | null>(() => {
    const state = previewState('tabs');
    return state && state !== 'default'
      ? {
          action: state === 'add' ? 'add' : 'manage',
          id: state === 'add' ? 'ui-new-canvas' : 'default',
          expected: sheets.raw ?? null,
        }
      : null;
  });
  const [name, setName] = useState(previewState('tabs') ? '전투 기획' : '');
  const [target, setTarget] = useState(previewState('tabs') ? 'combat' : '');
  const [busy, setBusy] = useState(previewState('tabs') === 'busy');
  const [error, setError] = useState(
    previewState('tabs') === 'error'
      ? '샘플 오류: 캔버스를 변경하지 못했습니다.'
      : '',
  );
  const open = (id?: string) => {
    setDialog({
      action: id ? 'manage' : 'add',
      id: id ?? `canvas-${crypto.randomUUID()}`,
      expected: sheets.raw ?? null,
    });
    setName(
      id
        ? (sheets.canvases.find((sheet) => sheet.id === id)?.name ?? '')
        : '새 캔버스',
    );
    setTarget(sheets.canvases.find((sheet) => sheet.id !== id)?.id ?? '');
    setError('');
  };
  const submit = async (
    action: CanvasSheetCommand['action'],
    order?: string[],
  ) => {
    if (!dialog || busy) return;
    setBusy(true);
    setError('');
    try {
      await change({
        action,
        id: dialog.id,
        name,
        targetId: target,
        order,
        expected: dialog.expected,
      });
      if (action === 'add') await switchTo(dialog.id);
      setDialog(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <nav
        className="canvas-tabs floating-surface"
        aria-label="프로젝트 캔버스"
      >
        <div
          className="canvas-tabs__list"
          role="tablist"
          aria-label="캔버스 목록"
        >
          {sheets.canvases.map((sheet) => (
            <div className="canvas-tabs__item" key={sheet.id}>
              <button
                role="tab"
                aria-selected={active === sheet.id}
                onClick={() => {
                  void switchTo(sheet.id).catch((caught) =>
                    setError(String(caught)),
                  );
                }}
              >
                {sheet.name}
                {unread.has(sheet.id) && (
                  <span
                    className="canvas-tabs__unread"
                    aria-label="새 결과물"
                  />
                )}
              </button>
              {!readOnly && (
                <button
                  className="canvas-tabs__manage"
                  aria-label={`${sheet.name} 캔버스 관리`}
                  onClick={() => open(sheet.id)}
                >
                  <MoreHorizontal size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          aria-label="캔버스 추가"
          title="캔버스 추가"
          disabled={readOnly || sheets.canvases.length >= 100}
          onClick={() => open()}
        >
          <Plus size={17} />
        </button>
      </nav>
      {dialog && (
        <div
          className="dialog-backdrop"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !busy) setDialog(null);
          }}
        >
          <section
            className="canvas-sheet-dialog floating-surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="canvas-sheet-title"
          >
            <header>
              <h2 id="canvas-sheet-title">
                {dialog.action === 'add' ? '캔버스 추가' : '캔버스 관리'}
              </h2>
              <button
                className="icon-button"
                disabled={busy}
                aria-label="닫기"
                onClick={() => setDialog(null)}
              >
                <X size={18} />
              </button>
            </header>
            <label>
              캔버스 이름
              <input
                autoFocus
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter')
                    void submit(dialog.action === 'add' ? 'add' : 'rename');
                }}
              />
            </label>
            <div className="canvas-sheet-dialog__actions">
              <button
                className="button-primary"
                disabled={busy || !name.trim()}
                onClick={() =>
                  void submit(dialog.action === 'add' ? 'add' : 'rename')
                }
              >
                {dialog.action === 'add' ? '추가' : '이름 저장'}
              </button>
            </div>
            {dialog.action === 'manage' && (
              <>
                <div className="canvas-sheet-dialog__actions">
                  {[-1, 1].map((offset) => {
                    const index = sheets.canvases.findIndex(
                      (sheet) => sheet.id === dialog.id,
                    );
                    const order = sheets.canvases.map((sheet) => sheet.id);
                    const next = index + offset;
                    return (
                      <button
                        key={offset}
                        disabled={busy || next < 0 || next >= order.length}
                        onClick={() => {
                          [order[index], order[next]] = [
                            order[next],
                            order[index],
                          ];
                          void submit('reorder', order);
                        }}
                      >
                        {offset < 0 ? (
                          <ArrowLeft size={14} />
                        ) : (
                          <ArrowRight size={14} />
                        )}{' '}
                        {offset < 0 ? '왼쪽으로' : '오른쪽으로'}
                      </button>
                    );
                  })}
                </div>
                <hr />
                <p>
                  캔버스를 삭제하면 자료를 아래 캔버스로 옮깁니다. 실제 파일은
                  유지됩니다.
                </p>
                <label>
                  자료를 받을 캔버스
                  <select
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                  >
                    {sheets.canvases
                      .filter((sheet) => sheet.id !== dialog.id)
                      .map((sheet) => (
                        <option key={sheet.id} value={sheet.id}>
                          {sheet.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  disabled={busy || sheets.canvases.length <= 1 || !target}
                  onClick={() => void submit('delete')}
                >
                  자료를 옮기고 캔버스 삭제
                </button>
              </>
            )}
            {error && <p role="alert">{error}</p>}
          </section>
        </div>
      )}
      {!dialog && error && (
        <div className="canvas-tabs__error" role="alert">
          {error}
          <button aria-label="오류 닫기" onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}
    </>
  );
}
