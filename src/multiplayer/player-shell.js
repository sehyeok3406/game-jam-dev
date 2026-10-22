/** Trusted UI, not part of generated game code. Bundled as an inline static shell. */
export async function installPlayerShell() {
  const api = window.gameJamPlayer;
  const title = document.querySelector('#title');
  const status = document.querySelector('#status');
  const members = document.querySelector('#members');
  const ready = document.querySelector('#ready');
  const start = document.querySelector('#start');
  const frame = document.querySelector('iframe');
  let room,
    boot,
    port,
    loaded = false,
    begunMatch;
  let connectionStage = 'connecting';
  const showFailure = (value) => {
    const raw = value?.failure || value || {};
    const embedded = String(raw.message || '').match(/\[(GC-MP-\d{3})\]/)?.[1];
    const code = boot?.errors?.[raw.code]
      ? raw.code
      : boot?.errors?.[embedded]
        ? embedded
        : 'GC-MP-029';
    const text = boot?.errors?.[code] || {
      message: '플레이 중 문제가 생겼어요.',
      hint: '게임을 다시 열어주세요. 반복되면 오류 정보를 전달해주세요.',
    };
    const incident =
      raw.id ||
      String(raw.message || '').match(/\[incident:([a-f0-9-]{36})\]/)?.[1];
    const failure = {
      code,
      id: incident,
      phase: text.phase,
      details: raw.details,
    };
    status.textContent = text.message;
    document.querySelector('#failure').hidden = false;
    document.querySelector('#failure-message').textContent = text.message;
    document.querySelector('#failure-hint').textContent = text.hint;
    document.querySelector('#failure-code').textContent =
      code + (incident ? ' · 추적 번호 ' + incident.slice(0, 8) : '');
    document.querySelector('#failure-detail').textContent = JSON.stringify(
      failure,
      null,
      2,
    );
  };
  document.querySelector('#copy-diagnostics').onclick = async () => {
    const result = document.querySelector('#copy-result');
    try {
      const value = await api.diagnostics(true);
      result.textContent = value.storageAvailable
        ? '오류 정보를 복사했어요.'
        : '오류 정보를 복사했어요. 파일 저장은 확인이 필요해요.';
    } catch {
      result.textContent =
        '복사하지 못했어요. 오류 코드와 추적 번호를 함께 전달해주세요.';
    }
  };
  const pause = () => port?.postMessage({ type: 'pause' });
  const context = () => ({
    selfId: boot.memberId,
    host: room.hostId === boot.memberId,
    solo: false,
    players: room.members.map((m) => ({ id: m.id, nickname: m.nickname })),
    seed: room.seed,
  });
  const begin = (snapshot) => {
    port?.postMessage({
      type: 'begin',
      context: context(),
      ...(snapshot ? { snapshot } : {}),
    });
    begunMatch = room.matchId;
  };
  const display = () => {
    title.textContent = '함께 플레이 · ' + room.title;
    members.textContent = room.members
      .map(
        (m) =>
          m.nickname +
          (m.id === room.hostId ? ' (방장)' : '') +
          (m.ready ? ' · 준비' : m.connected ? ' · 접속' : ' · 연결 대기'),
      )
      .join(' / ');
    status.textContent =
      room.reason ||
      {
        lobby: '모두 준비하면 방장이 시작할 수 있습니다.',
        loading: '같은 게임을 준비하고 있습니다.',
        running: '함께 플레이 중',
        paused: '연결 복구를 기다리고 있습니다.',
        finished: '이번 판 종료 · 다시 준비할 수 있습니다.',
        closed: '방 종료',
      }[room.status];
    if (room.failure) showFailure(room.failure);
    else if (room.status === 'running')
      document.querySelector('#failure').hidden = true;
    const self = room.members.find((m) => m.id === boot.memberId);
    if (!room.failure && !['finished', 'closed'].includes(room.status)) {
      if (connectionStage === 'connecting')
        status.textContent = '서버에 연결하고 있어요.';
      if (connectionStage === 'joining')
        status.textContent = '방에 참가하고 있어요.';
      if (connectionStage === 'recovering')
        status.textContent = '다시 연결하고 있어요.';
      if (self?.connected && !loaded)
        status.textContent = '게임을 준비하고 있어요.';
    }
    ready.disabled =
      !loaded ||
      !['lobby', 'finished'].includes(room.status) ||
      !self?.connected;
    ready.textContent = self?.ready ? '준비 취소' : '준비';
    start.hidden = room.hostId !== boot.memberId;
    start.disabled =
      !['lobby', 'finished'].includes(room.status) ||
      room.members.length < 2 ||
      !room.members.every((m) => m.ready && m.connected);
  };
  try {
    boot = await api.bootstrap();
    room = boot.room;
    api.onMessage((message) => {
      if (message.type === 'room') {
        room = message.room;
        if (
          room.members.some(
            (member) => member.id === boot.memberId && member.connected,
          )
        )
          connectionStage = loaded ? 'ready' : 'preparing';
        display();
        if (room.status === 'loading' && begunMatch !== room.matchId && loaded)
          begin();
        if (room.status === 'running') port?.postMessage({ type: 'run' });
        if (['paused', 'finished', 'closed', 'lobby'].includes(room.status))
          pause();
      } else if (message.type === 'restore') {
        room = message.room;
        connectionStage = loaded ? 'ready' : 'preparing';
        display();
        if (message.snapshot) {
          begin(message.snapshot);
          if (room.status === 'running') port?.postMessage({ type: 'run' });
        }
      } else if (message.type === 'snapshot' || message.type === 'input')
        port?.postMessage(message);
      else if (message.type === 'connection') {
        connectionStage =
          message.stage || (message.connected ? 'ready' : 'recovering');
        if (!message.connected) pause();
        if (message.failure) showFailure(message.failure);
        else {
          if (message.connected)
            document.querySelector('#failure').hidden = true;
          display();
        }
      } else if (message.type === 'error') {
        pause();
        showFailure(message.failure || { code: message.code });
      }
    });
    ready.onclick = async () => {
      try {
        const self = room.members.find((m) => m.id === boot.memberId);
        await api.control({ action: 'ready', ready: !self?.ready });
      } catch (error) {
        showFailure(error);
      }
    };
    start.onclick = async () => {
      try {
        await api.control({ action: 'start', expectedRevision: room.revision });
      } catch (error) {
        showFailure(error);
      }
    };
    frame.onload = () => {
      const channel = new MessageChannel();
      port?.close();
      port = channel.port1;
      port.onmessage = (event) => {
        const message = event.data;
        if (message?.type === 'loaded') {
          loaded = true;
          display();
        }
        if (
          ['loaded', 'begun', 'input', 'snapshot', 'finish', 'error'].includes(
            message?.type,
          )
        ) {
          try {
            api.send(message);
          } catch (error) {
            pause();
            showFailure(error);
          }
        }
      };
      port.start();
      frame.contentWindow.postMessage(
        { type: 'gamejam:connect', id: boot.bridgeId },
        '*',
        [channel.port2],
      );
    };
    frame.srcdoc = boot.html;
    display();
    api.connect();
  } catch (error) {
    showFailure(error);
  }
}
