import { X } from 'lucide-react';
import { useState } from 'react';
import type { AiProviderId, CollaborationState } from '../shared';
import { DiscordApprovalSettings } from './DiscordApprovalSettings';
import { DiscordApprovalGuide } from './DiscordApprovalGuide';

export function DiscordApprovalDialog({
  collaboration,
  provider,
  model,
  close,
  openCollaboration,
}: {
  collaboration: CollaborationState;
  provider: AiProviderId;
  model: string;
  close: () => void;
  openCollaboration: () => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <div className="dialog-backdrop">
      <section
        className="approval-inbox discord-approval-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discord-approval-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            close();
          }
        }}
      >
        <header>
          <h2 id="discord-approval-title">디스코드 알림 · 테스트</h2>
          <button aria-label="디스코드 알림 닫기" onClick={close}>
            <X size={18} />
          </button>
        </header>
        <div className="discord-guide-entry">
          <button
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen(!helpOpen)}
          >
            {helpOpen ? '설정으로 돌아가기' : '관리자 설정 도움말'}
          </button>
          {!helpOpen && <span>처음 연결하시나요? 단계별로 안내해드려요.</span>}
        </div>
        <div hidden={!helpOpen}>
          <DiscordApprovalGuide
            active={helpOpen}
            back={() => setHelpOpen(false)}
          />
        </div>
        <div hidden={helpOpen}>
          {collaboration.active ? (
            <DiscordApprovalSettings
              provider={provider}
              model={model}
              connected={collaboration.connected && !collaboration.accessDenied}
              defaultOpen
            />
          ) : (
            <div>
              <p>
                테스트 알림을 보내려면 공동 프로젝트를 만들거나 관리자 계정으로
                참여해주세요. 연결한 프로젝트의 알림 채널로 테스트를 보냅니다.
              </p>
              <button className="button-primary" onClick={openCollaboration}>
                함께 작업 연결하기
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
