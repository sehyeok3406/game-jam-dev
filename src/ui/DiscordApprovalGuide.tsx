import { useEffect, useRef, useState } from 'react';
import { useRuntime } from './runtime/RuntimeProvider';
import { ArrowLeft, ArrowRight, ExternalLink } from 'lucide-react';
import type { DiscordHelpPage } from '../discord-approval-help';

function OfficialLink({
  page,
  children,
}: {
  page: DiscordHelpPage;
  children: React.ReactNode;
}) {
  const { api } = useRuntime();
  const [error, setError] = useState('');
  return (
    <>
      <button
        className="discord-guide-link"
        onClick={() => {
          setError('');
          void api.desktop?.discordApproval
            ?.openHelp(page)
            .catch(() =>
              setError('브라우저를 열지 못했습니다. 잠시 후 다시 눌러주세요.'),
            );
        }}
      >
        {children} <ExternalLink size={14} />
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

const steps = [
  {
    title: '관리자 PC와 프로젝트 준비',
    content: (
      <>
        <p className="discord-guide-lead">
          관리자가 처음 한 번 설정하면 됩니다. 팀원은 설정 없이 요청하기만
          누르면 돼요.
        </p>
        <ul>
          <li>
            Game Jam!에서 알림을 받을 공동 프로젝트를{' '}
            <strong>관리자 계정</strong>으로 엽니다. 개인 프로젝트라면 먼저
            ‘함께 작업’으로 공동 프로젝트를 만드세요.
          </li>
          <li>
            봇을 추가할 디스코드 서버와 그 서버에 앱을 추가할 수 있는 계정을
            준비합니다.
          </li>
          <li>
            승인 후 AI 구현을 실행하려면 Game Jam!의{' '}
            <strong>설정 및 도구 → AI 연결 설정</strong>에서 실행할 AI에
            로그인해두세요.
          </li>
        </ul>
        <aside>
          알림과 원격 승인을 받는 동안 이 PC·Game Jam! 앱·해당 공동 프로젝트와
          협업 서버를 켜두세요. PC 절전이나 앱 종료 중에는 처리할 수 없습니다.
        </aside>
      </>
    ),
  },
  {
    title: '디스코드 봇 만들기 · 토큰 준비',
    content: (
      <>
        <p>아래 Developer Portal을 열고 디스코드 계정으로 로그인합니다.</p>
        <OfficialLink page="portal">Discord Developer Portal 열기</OfficialLink>
        <ol>
          <li>
            <strong>New Application</strong>을 눌러 봇 이름을 정하고 만듭니다.
            예: ‘Game Jam 승인 봇’.
          </li>
          <li>
            왼쪽 <strong>Bot → Token → Reset Token</strong>에서 토큰을 발급하고
            복사합니다. 비밀번호나 인증 코드를 요청하면 본인 인증을 마칩니다.
          </li>
          <li>
            복사한 값은 Game Jam!의 <strong>봇 토큰</strong> 칸에 입력할
            값입니다. 이 도움말의 ‘설정으로 돌아가기’를 눌러 입력하고 다시
            이어서 볼 수 있어요.
          </li>
        </ol>
        <aside>
          토큰은 봇의 비밀번호입니다. 채팅이나 팀 문서에 공유하지 마세요. 이미
          사용하는 토큰이 있다면 재발급할 필요가 없습니다. 재발급하면 이전
          토큰은 사용할 수 없습니다.
        </aside>
        <p className="discord-guide-note">
          Bot의 Privileged Gateway Intents는 기본값으로 두고, General
          Information의 Interactions Endpoint URL은 비워두세요. 별도 봇
          프로그램을 설치할 필요 없이 Game Jam!이 봇을 실행합니다.
        </p>
      </>
    ),
  },
  {
    title: '서버에 봇 추가 · 권한 선택',
    content: (
      <>
        <ol>
          <li>
            Developer Portal의 내 앱에서{' '}
            <strong>Installation → Guild Install</strong>을 사용하도록
            설정합니다.
          </li>
          <li>
            <strong>Install Link → Discord Provided Link</strong>를 선택하고,
            Guild Install의 Scopes에 <strong>bot</strong>을 추가합니다.
          </li>
          <li>
            아래 권한을 선택한 뒤 설치 링크를 열고 <strong>서버에 추가</strong>
            에서 팀 서버를 고릅니다. 서버 목록에 없으면 서버 관리자에게 설치를
            요청하세요.
          </li>
        </ol>
        <table>
          <caption>봇에 허용할 채널 권한</caption>
          <tbody>
            <tr>
              <th scope="row">기본</th>
              <td>
                View Channels · Send Messages · Embed Links · Read Message
                History · Attach Files
              </td>
            </tr>
            <tr>
              <th scope="row">요청별 스레드를 사용할 때 추가</th>
              <td>Create Public Threads · Send Messages in Threads</td>
            </tr>
          </tbody>
        </table>
        <p>
          각각 채널 보기·메시지 보내기·링크 임베드·메시지 기록 보기·파일 첨부,
          공개 스레드 만들기·스레드에서 메시지 보내기 권한입니다.
        </p>
        <p className="discord-guide-note">
          Administrator·투표·반응 추가 권한은 필요하지 않습니다. 승인 버튼에도
          별도 투표 권한은 필요하지 않아요. 스레드 권한을 줄 수 없다면 앱에서
          ‘요청별 스레드’ 옵션을 끄세요.
        </p>
        <OfficialLink page="permissions">Discord 공식 권한 안내</OfficialLink>
      </>
    ),
  },
  {
    title: '알림용 비공개 텍스트 채널 만들기',
    content: (
      <>
        <ol>
          <li>
            디스코드 팀 서버에서 <strong>채널 만들기 → 텍스트</strong>를
            선택합니다. 예: ‘AI 승인 채널’.
          </li>
          <li>
            <strong>비공개 채널</strong>로 만들고, 승인할 관리자와 앞에서 추가한
            봇 또는 봇 역할을 허용합니다.
          </li>
          <li>
            <strong>채널 편집 → 권한</strong>에서 봇이 이전 단계의 권한을 갖는지
            확인합니다. 상위 카테고리의 권한 때문에 차단되지 않았는지도
            확인하세요.
          </li>
        </ol>
        <aside>
          서버에 봇을 추가했어도 비공개 채널 접근을 허용해야 알림을 보낼 수
          있습니다.
        </aside>
        <p>
          ‘요청별 스레드’는 이 채널 안에 만듭니다. 공개 스레드라는 이름이어도
          비공개 부모 채널을 볼 수 있는 사람에게만 보입니다.
        </p>
      </>
    ),
  },
  {
    title: '채널 ID와 승인자 ID 복사',
    content: (
      <>
        <p>
          디스코드 PC 앱에서 <strong>사용자 설정 → 고급 → 개발자 모드</strong>를
          켭니다.
        </p>
        <dl>
          <dt>알림 채널 ID</dt>
          <dd>
            앞에서 만든 텍스트 채널을 오른쪽 클릭 →{' '}
            <strong>채널 ID 복사</strong>. Game Jam!의 ‘알림 채널 ID’에
            붙여넣습니다.
          </dd>
          <dt>승인할 사용자 ID</dt>
          <dd>
            디스코드에서 승인을 누를{' '}
            <strong>본인 또는 지정한 관리자 계정</strong>을 오른쪽 클릭 →{' '}
            <strong>사용자 ID 복사</strong>. ‘승인할 사용자 ID’에 붙여넣습니다.
          </dd>
        </dl>
        <aside>
          채널 이름이나 사용자 닉네임 대신 숫자로 된 ID를 입력합니다. 서버 ID·봇
          ID·Application ID와 혼동하지 마세요. 지정한 사용자만 원격 승인할 수
          있습니다.
        </aside>
        <OfficialLink page="ids">Discord 공식 ID 복사 안내</OfficialLink>
      </>
    ),
  },
  {
    title: 'Game Jam!에서 저장하고 연결',
    content: (
      <>
        <p>
          ‘설정으로 돌아가기’를 눌러 아래 항목을 입력합니다. 도움말을 열고
          닫아도 입력 중인 값은 유지됩니다.
        </p>
        <dl>
          <dt>봇 토큰</dt>
          <dd>
            2단계에서 복사한 토큰. 이미 저장했다면 교체할 때만 입력합니다.
          </dd>
          <dt>알림 채널 ID · 승인할 사용자 ID</dt>
          <dd>5단계에서 복사한 두 숫자 ID.</dd>
          <dt>원격 실행 AI · 모델</dt>
          <dd>
            관리자 PC에 연결한 AI를 선택합니다. 모델은 비워두면 기본 모델을
            사용합니다.
          </dd>
          <dt>요청별 스레드</dt>
          <dd>
            요청 이력과 검토 문서 사본을 스레드로 받으려면 켭니다. 3단계의 추가
            권한도 필요합니다.
          </dd>
        </dl>
        <p>
          <strong>저장하고 연결</strong>을 누른 뒤 ‘연결됨’을 확인하세요. 설정은
          이 PC에 저장되고 봇 토큰은 암호화해 보관합니다.
        </p>
        <aside>
          지정한 디스코드 사용자에게 현재 프로젝트의 관리자 승인 권한을
          연결합니다. 다른 프로젝트에서 사용할 때는 그 프로젝트를 관리자
          계정으로 열고 다시 연결하세요.
        </aside>
      </>
    ),
  },
  {
    title: '테스트하고 팀원 요청 받기',
    content: (
      <>
        <ol>
          <li>
            설정 화면에서 <strong>테스트 알림 보내기</strong>를 누릅니다. 설정을
            바꿨다면 먼저 ‘저장하고 연결’을 다시 누릅니다.
          </li>
          <li>
            디스코드 채널에 메시지가 오면 지정한 승인자 계정으로{' '}
            <strong>테스트 수신 확인</strong>을 누릅니다. 스레드 옵션을 켰다면
            테스트 스레드도 확인합니다.
          </li>
          <li>
            이제 팀원이 <strong>gamejam! → 요청하기</strong>를 누르면 이 채널에
            알림이 옵니다. 관리자만 요청을 검토하고 승인하며, AI 작업은 관리자
            PC에서 순서대로 실행됩니다.
          </li>
        </ol>
        <p className="discord-guide-lead">
          팀원은 봇 토큰이나 ID를 입력할 필요가 없습니다. 테스트 알림은 실제
          구현 요청이나 AI 실행을 만들지 않아요.
        </p>
        <details>
          <summary>연결이나 테스트가 안 될 때</summary>
          <ul>
            <li>
              알림이 안 오면 봇 토큰·채널 ID, 비공개 채널의 봇 접근과 메시지
              권한을 확인합니다.
            </li>
            <li>
              채널 메시지만 오면 스레드 권한을 확인하거나 스레드 옵션을 끄고
              다시 저장합니다.
            </li>
            <li>
              버튼을 누를 수 없으면 지정한 사용자 ID와 현재 디스코드 계정이
              같은지 확인합니다.
            </li>
            <li>
              승인 후 실행되지 않으면 관리자 PC의 앱·공동 프로젝트·협업 서버
              연결, AI 로그인과 작업 목록을 확인합니다.
            </li>
          </ul>
        </details>
      </>
    ),
  },
];

export function DiscordApprovalGuide({
  active,
  back,
}: {
  active: boolean;
  back: () => void;
}) {
  const [page, setPage] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (active) heading.current?.focus();
  }, [page, active]);
  return (
    <section className="discord-approval-guide" aria-label="관리자 설정 도움말">
      <div className="discord-guide-progress" aria-live="polite">
        <span>관리자 설정 도움말</span>
        <span>
          {page + 1} / {steps.length} 단계
        </span>
        <progress
          aria-label="설정 안내 단계"
          value={page + 1}
          max={steps.length}
        />
      </div>
      <article key={page} data-guide-step={page + 1}>
        <h3 ref={heading} tabIndex={-1}>
          {steps[page].title}
        </h3>
        {steps[page].content}
      </article>
      <footer>
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>
          <ArrowLeft size={15} /> 이전
        </button>
        <button onClick={back}>설정으로 돌아가기</button>
        {page < steps.length - 1 ? (
          <button className="button-primary" onClick={() => setPage(page + 1)}>
            다음 <ArrowRight size={15} />
          </button>
        ) : (
          <button className="button-primary" onClick={back}>
            연결 설정 열기
          </button>
        )}
      </footer>
    </section>
  );
}
