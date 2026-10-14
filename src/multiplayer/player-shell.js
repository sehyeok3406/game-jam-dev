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
    const self = room.members.find((m) => m.id === boot.memberId);
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
        display();
        if (room.status === 'loading' && begunMatch !== room.matchId && loaded)
          begin();
        if (room.status === 'running') port?.postMessage({ type: 'run' });
        if (['paused', 'finished', 'closed', 'lobby'].includes(room.status))
          pause();
      } else if (message.type === 'restore') {
        room = message.room;
        if (message.snapshot) {
          begin(message.snapshot);
          if (room.status === 'running') port?.postMessage({ type: 'run' });
        }
      } else if (message.type === 'snapshot' || message.type === 'input')
        port?.postMessage(message);
      else if (message.type === 'connection' && !message.connected) {
        pause();
        status.textContent = '연결 끊김 · 다시 연결하는 중입니다.';
      } else if (message.type === 'error') {
        pause();
        status.textContent = message.message;
      }
    });
    ready.onclick = async () => {
      try {
        const self = room.members.find((m) => m.id === boot.memberId);
        await api.control({ action: 'ready', ready: !self?.ready });
      } catch (error) {
        status.textContent = error.message;
      }
    };
    start.onclick = async () => {
      try {
        await api.control({ action: 'start', expectedRevision: room.revision });
      } catch (error) {
        status.textContent = error.message;
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
            status.textContent = error.message;
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
    status.textContent = error.message;
  }
}
