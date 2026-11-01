import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FilePenLine } from 'lucide-react';
import type { AppApi } from '../../contracts/app-api';
import type { FileNamePlan } from '../../contracts/document-names';
import { documentName } from '../../core/documents/file-name';
import { ProjectLayoutControl } from './ProjectLayoutControl';

export function FileNameControl({
  api,
  disabled,
  prepare,
  refresh,
}: {
  api: AppApi;
  disabled: boolean;
  prepare?: () => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const [plan, setPlan] = useState<FileNamePlan | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const request = useRef(0),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const close = () => {
    request.current++;
    setPlan(null);
    setError('');
    trigger.current?.focus();
  };
  const inspect = async () => {
    const ticket = ++request.current;
    setBusy(true);
    setError('');
    try {
      if (!prepare) throw Error('파일 이름을 변경할 수 없는 환경입니다.');
      await prepare();
      const workspace = await api.projects.getWorkspace();
      if (!workspace.saveScope) throw Error('프로젝트를 먼저 열어주세요.');
      const result = await api.editor.inspectFileNames(workspace.saveScope);
      if (ticket === request.current) {
        setPlan(result);
        setChosen(
          new Set(result.proposals.filter((p) => !p.error).map((p) => p.id)),
        );
      }
    } catch (e) {
      if (ticket === request.current) setError((e as Error).message);
    } finally {
      if (ticket === request.current) setBusy(false);
    }
  };
  const apply = async () => {
    if (!plan) return;
    const ticket = ++request.current;
    setBusy(true);
    setError('');
    try {
      const proposals = plan.proposals
        .filter((p) => chosen.has(p.id))
        .map((p) => ({ ...p, name: documentName(p.name) }));
      if (!prepare) throw Error('파일 이름을 변경할 수 없는 환경입니다.');
      await prepare();
      await api.editor.unifyFileNames({
        scope: plan.scope,
        baseline: plan.baseline,
        proposals,
      });
      if (ticket !== request.current) return;
      await refresh();
      await inspect();
    } catch (e) {
      if (ticket === request.current) setError((e as Error).message);
    } finally {
      if (ticket === request.current) setBusy(false);
    }
  };
  return (
    <>
      <button
        ref={trigger}
        disabled={disabled || busy || !prepare}
        onClick={() => void inspect()}
      >
        <FilePenLine size={16} /> 파일 이름 통일…
      </button>
      {error && !plan && <p role="alert">{error}</p>}
      {plan &&
        createPortal(
          <div className="dialog-backdrop">
            <section
              role="dialog"
              aria-modal="true"
              aria-label="파일 이름 통일"
              className="file-name-dialog import-dialog floating-surface"
              onKeyDown={(e) => {
                if (e.key === 'Escape' && !busy) {
                  e.preventDefault();
                  e.stopPropagation();
                  close();
                }
                if (e.key === 'Tab') {
                  const buttons = [
                      ...e.currentTarget.querySelectorAll<HTMLElement>(
                        'button:not(:disabled),input:not(:disabled)',
                      ),
                    ],
                    first = buttons[0],
                    last = buttons.at(-1);
                  if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last?.focus();
                  } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first?.focus();
                  }
                }
              }}
            >
              <h2>파일 이름 통일</h2>
              <p>
                캔버스 제목을 기준으로 실제 파일 이름과 연결 정보를 함께
                변경합니다. 적용할 파일과 최종 이름을 확인해주세요.
              </p>
              {plan.needsLayoutUpgrade && (
                <div className="file-name-upgrade">
                  <p>
                    고정된 프로젝트 문서는 파일 구조를 정리한 뒤 이름을 통일할
                    수 있습니다.
                  </p>
                  <ProjectLayoutControl
                    api={api}
                    disabled={busy || disabled}
                    prepare={prepare}
                    refresh={async () => {
                      await refresh();
                      await inspect();
                    }}
                  />
                </div>
              )}
              {plan.proposals.length ? (
                <div className="file-name-rows">
                  {plan.proposals.map((p) => (
                    <div className="file-name-row" key={p.id}>
                      <label>
                        <input
                          type="checkbox"
                          aria-label={`${p.from} 변경 선택`}
                          disabled={busy || p.from === 'project.md'}
                          checked={chosen.has(p.id)}
                          onChange={(e) =>
                            setChosen((previous) => {
                              const next = new Set(previous);
                              if (e.target.checked) next.add(p.id);
                              else next.delete(p.id);
                              return next;
                            })
                          }
                        />
                        <span>
                          {p.kind === 'html' ? 'HTML' : 'Markdown'} · {p.from}
                        </span>
                      </label>
                      {p.currentName && (
                        <small>현재 제목: {p.currentName}</small>
                      )}
                      <label>
                        최종 이름
                        <input
                          aria-label={`${p.from} 최종 이름`}
                          value={p.name}
                          disabled={busy || p.from === 'project.md'}
                          onChange={(e) => {
                            const name = e.target.value;
                            setPlan((previous) =>
                              previous
                                ? {
                                    ...previous,
                                    affectedPaths: previous.affectedPaths.map(
                                      (path) =>
                                        path === p.to
                                          ? p.from.slice(
                                              0,
                                              p.from.lastIndexOf('/') + 1,
                                            ) +
                                            name +
                                            (p.kind === 'html'
                                              ? '.html'
                                              : '.md')
                                          : path,
                                    ),
                                    proposals: previous.proposals.map((row) =>
                                      row.id === p.id
                                        ? {
                                            ...row,
                                            name,
                                            to:
                                              row.from.slice(
                                                0,
                                                row.from.lastIndexOf('/') + 1,
                                              ) +
                                              name +
                                              (row.kind === 'html'
                                                ? '.html'
                                                : '.md'),
                                            error: undefined,
                                          }
                                        : row,
                                    ),
                                  }
                                : null,
                            );
                          }}
                        />
                      </label>
                      <small title={p.to}>→ {p.to}</small>
                      {p.error && <p role="alert">{p.error}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p role="status">통일할 파일 이름이 없습니다.</p>
              )}
              <details>
                <summary>관련 파일 {plan.affectedPaths.length}개</summary>
                <ul>
                  {plan.affectedPaths.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </details>
              {error && <p role="alert">{error}</p>}
              <div className="import-dialog-actions">
                <button autoFocus disabled={busy} onClick={close}>
                  닫기
                </button>
                <button disabled={busy} onClick={() => void inspect()}>
                  다시 검사
                </button>
                <button
                  className="button-primary"
                  disabled={
                    busy ||
                    disabled ||
                    !chosen.size ||
                    plan.proposals.some((p) => chosen.has(p.id) && p.error)
                  }
                  onClick={() => void apply()}
                >
                  {busy ? '처리 중…' : `선택한 ${chosen.size}개 이름 통일`}
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
