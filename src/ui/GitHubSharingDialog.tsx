import { Copy, GitBranch, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useRuntime } from './runtime/RuntimeProvider';
import { requireDesktopApi } from './runtime/desktop-api';

const attributes =
  'assets/audio/** filter=lfs diff=lfs merge=lfs -text\nassets/models/** filter=lfs diff=lfs merge=lfs -text\n';
const ignore =
  '/.gamejam/local/\n/.history/\n/.canvas/previews/\n/.canvas/preview.json\n/.canvas/authorship.json\n';

export function GitHubSharingDialog({ close }: { close(): void }) {
  const { api } = useRuntime();
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  async function copy(name: string, value: string) {
    try {
      await requireDesktopApi(api).copyText(value);
      setStatus(`${name} 예제를 복사했습니다.`);
    } catch {
      setStatus(
        '클립보드에 복사할 수 없습니다. 예제 텍스트를 선택해 복사해주세요.',
      );
    }
  }
  return (
    <dialog
      ref={dialog}
      className="web-viewer-dialog github-sharing-dialog"
      aria-labelledby="github-sharing-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="web-viewer-dialog-heading">
        <GitBranch size={22} />
        <h2 id="github-sharing-title">GitHub 공유 안내</h2>
        <button type="button" aria-label="닫기" onClick={close}>
          <X size={20} />
        </button>
      </header>
      <ol>
        <li>
          팀원 PC에 Git LFS를 설치하고 <code>git lfs install</code>을
          실행하세요.
        </li>
        <li>
          프로젝트 루트의 <code>.gitattributes</code>와 <code>.gitignore</code>
          에 다음 예제를 추가하세요.
        </li>
      </ol>
      {(
        [
          ['.gitattributes', attributes],
          ['.gitignore', ignore],
        ] as const
      ).map(([name, value]) => (
        <section key={name}>
          <div className="github-sharing-dialog__file">
            <strong>{name}</strong>
            <button type="button" onClick={() => void copy(name, value)}>
              <Copy size={14} /> 복사
            </button>
          </div>
          <pre>
            <code>{value}</code>
          </pre>
        </section>
      ))}
      <ol start={3}>
        <li>
          <code>docs/</code>, <code>assets/</code>, <code>output/</code>,{' '}
          <code>.gamejam/project/</code>와 설정 파일을 함께 커밋하고 푸시하세요.{' '}
          <code>.gamejam/local/</code>에는 개인 설정과 로컬 편집 기록이 있어요.
        </li>
        <li>
          팀원은 저장소를 <code>git clone</code>한 뒤, 받은 폴더를 로컬
          프로젝트로 여세요. 변경을 받을 때는 <code>git pull</code>, 원본 파일을
          내려받을 때는 <code>git lfs pull</code>을 실행하세요.
        </li>
      </ol>
      <p role="status">{status}</p>
    </dialog>
  );
}
