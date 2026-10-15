import { X } from 'lucide-react';
import type { AiProviderId, CollaborationState } from '../shared';
import { DiscordApprovalSettings } from './DiscordApprovalSettings';

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
      </section>
    </div>
  );
}
