/** Serialized into an opaque iframe. Deliberately has no app or Node dependencies. */
export function installMultiplayerSdk(config) {
  if (window.GameJamMultiplayer) throw Error('GameJamMultiplayer is reserved');
  let adapter,
    port,
    state,
    renderState,
    active = false,
    context,
    inputSeq = 0;
  let tick = 0,
    rng = 1,
    stateSeq = 0,
    lastSnapshot = 0,
    keys = {};
  let broken = false;
  const inputs = new Map();
  const sequences = new Map();
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const gameCopy = (value) =>
    JSON.parse(
      JSON.stringify(value, (_key, item) => {
        if (
          item === undefined ||
          typeof item === 'function' ||
          typeof item === 'symbol' ||
          typeof item === 'bigint' ||
          (typeof item === 'number' && !Number.isFinite(item))
        )
          throw new TypeError('Invalid game data');
        return item;
      }),
    );
  const send = (message) => port?.postMessage(message);
  let pendingFailure;
  const phases = {
    register: 'GC-MP-014',
    createState: 'GC-MP-013',
    validateInput: 'GC-MP-015',
    step: 'GC-MP-016',
    render: 'GC-MP-017',
    getOutcome: 'GC-MP-018',
    serialize: 'GC-MP-002',
    script: 'GC-MP-025',
    reportIssue: 'GC-MP-029',
  };
  const fail = (error, callback = 'script', extra = {}) => {
    if (broken) return;
    broken = true;
    active = false;
    let errorName = 'Error',
      line,
      column;
    try {
      if (
        [
          'Error',
          'TypeError',
          'SyntaxError',
          'RangeError',
          'ReferenceError',
          'EvalError',
          'URIError',
          'AggregateError',
        ].includes(error?.name)
      )
        errorName = error.name;
      const location = String(error?.stack || '')
        .slice(-4000)
        .match(/(?:<anonymous>|about:srcdoc):(\d+):(\d+)/);
      if (location) {
        line = Number(location[1]);
        column = Number(location[2]);
      }
    } catch {
      /* Never serialize an exception object supplied by the game. */
    }
    const code =
      extra.bytes > extra.limit ? 'GC-MP-019' : phases[callback] || 'GC-MP-025';
    pendingFailure = {
      type: 'error',
      code,
      message: '게임을 실행하다가 문제가 생겼어요.',
      diagnostic: copy({ callback, errorName, line, column, tick, ...extra }),
    };
    send(pendingFailure);
    if (config.mode === 'solo') {
      window.parent.postMessage(
        {
          type: 'gamejam:diagnostic',
          id: config.id,
          diagnostic: pendingFailure,
        },
        '*',
      );
      const show = () => {
        if (document.getElementById('gamejam-error')) return;
        const panel = document.createElement('section');
        panel.id = 'gamejam-error';
        panel.setAttribute('role', 'alert');
        panel.style.cssText =
          'position:fixed;z-index:2147483647;inset:12px 12px auto;padding:18px;border:1px solid #e7b36c;border-radius:10px;background:#182333;color:#fff;font:15px system-ui';
        const text = config.errors?.[code];
        const heading = document.createElement('strong');
        heading.textContent = text?.message || pendingFailure.message;
        const help = document.createElement('p');
        help.textContent =
          text?.hint ||
          '게임을 다시 열어주세요. 반복되면 오류 정보를 전달해주세요.';
        const detail = document.createElement('details'),
          summary = document.createElement('summary'),
          pre = document.createElement('pre');
        summary.textContent = '오류 정보';
        pre.textContent = JSON.stringify(
          { code, ...pendingFailure.diagnostic },
          null,
          2,
        );
        detail.append(summary, pre);
        panel.append(heading, help, detail);
        document.body.append(panel);
      };
      if (document.body) show();
      else document.addEventListener('DOMContentLoaded', show, { once: true });
    }
    console.error('Game Jam! [' + code + '] ' + callback + ' ' + errorName);
  };
  const invoke = (phase, action) => {
    try {
      return action();
    } catch (error) {
      fail(error, phase);
      throw error;
    }
  };
  window.addEventListener('error', (e) =>
    fail(e.error, 'script', {
      line: Number.isSafeInteger(e.lineno) ? e.lineno : undefined,
      column: Number.isSafeInteger(e.colno) ? e.colno : undefined,
    }),
  );
  window.addEventListener('unhandledrejection', (e) =>
    fail(e.reason, 'script'),
  );
  setTimeout(() => {
    if (!adapter && !broken) fail(new Error('Not registered'), 'register');
  }, 10000);
  const random = () => {
    rng = (Math.imul(1664525, rng) + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  const snapshot = () => ({
    state: copy(state),
    tick,
    rng,
    emission: stateSeq,
    sequences: [...sequences],
  });
  const restore = (data) => {
    state = copy(data.state);
    tick = data.tick;
    rng = data.rng;
    stateSeq = data.emission || 0;
    sequences.clear();
    for (const [id, seq] of data.sequences || []) sequences.set(id, seq);
    renderState = copy(state);
  };
  function begin(message) {
    broken = false;
    pendingFailure = undefined;
    context = message.context;
    inputs.clear();
    sequences.clear();
    inputSeq = 0;
    tick = 0;
    stateSeq = 0;
    lastSnapshot = 0;
    rng = context.seed >>> 0;
    if (message.snapshot) restore(message.snapshot);
    else if (context.host) {
      state = invoke('createState', () =>
        adapter.createState({
          players: context.players,
          seed: context.seed,
          random,
          solo: context.solo,
        }),
      );
      renderState = invoke('serialize', () => gameCopy(state));
    }
    active = context.solo;
    send({ type: 'begun' });
    if (context.host && !context.solo)
      invoke('serialize', () => {
        const value = snapshot();
        value.emission = stateSeq + 1;
        const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
        if (bytes > 32768) {
          fail(new RangeError('State size'), 'serialize', {
            bytes,
            limit: 32768,
          });
          return;
        }
        send({ type: 'snapshot', sequence: ++stateSeq, snapshot: value });
      });
  }
  function receive(message) {
    try {
      if (broken && !['begin', 'inspect'].includes(message.type)) return;
      if (message.type === 'begin') begin(message);
      if (message.type === 'run') active = true;
      if (message.type === 'pause') {
        active = false;
        inputs.clear();
        keys = {};
      }
      if (message.type === 'input' && context?.host && active) {
        const key = message.connectionId || message.playerId;
        if (message.sequence <= (sequences.get(key) || 0)) return;
        if (
          invoke('validateInput', () =>
            adapter.validateInput(message.input),
          ) !== true
        )
          return;
        sequences.set(key, message.sequence);
        if (sequences.size > 32)
          sequences.delete(sequences.keys().next().value);
        const previous = inputs.get(message.playerId);
        inputs.set(message.playerId, {
          playerId: message.playerId,
          input: copy(message.input),
          sequence: message.sequence,
          at: performance.now(),
          fresh: true,
          previous: previous?.input,
        });
      }
      if (message.type === 'snapshot' && context && !context.host) {
        restore(message.snapshot);
      }
      if (message.type === 'inspect')
        send({
          type: 'inspection',
          id: message.id,
          snapshot: state === undefined ? null : snapshot(),
          registered: !!adapter,
          active,
        });
    } catch (error) {
      fail(error);
    }
  }
  const api = Object.freeze({
    register(value) {
      try {
        if (adapter) throw Error('Game adapter already registered');
        for (const key of [
          'createState',
          'validateInput',
          'step',
          'render',
          'getOutcome',
        ])
          if (typeof value?.[key] !== 'function')
            throw Error('Missing game adapter: ' + key);
        adapter = value;
        if (config.mode === 'solo')
          begin({
            context: {
              selfId: 'solo',
              host: true,
              solo: true,
              players: [{ id: 'solo', nickname: '나' }],
              seed: 1,
            },
          });
        else send({ type: 'loaded' });
      } catch (error) {
        fail(error, 'register');
      }
    },
    sendInput(input) {
      if (broken || !active || !context) return;
      try {
        keys = invoke('validateInput', () => gameCopy(input));
        if (new TextEncoder().encode(JSON.stringify(keys)).length > 1024) {
          fail(new RangeError('Input size'), 'validateInput', {
            bytes: new TextEncoder().encode(JSON.stringify(keys)).length,
            limit: 1024,
          });
          return;
        }
        if (context.solo)
          receive({
            type: 'input',
            playerId: 'solo',
            sequence: ++inputSeq,
            input: keys,
          });
      } catch (error) {
        fail(error, 'validateInput');
      }
    },
    reportIssue(issue) {
      const callback =
        {
          controls: 'validateInput',
          rules: 'step',
          display: 'render',
          other: 'reportIssue',
        }[issue?.area] || 'reportIssue';
      const customCode =
        typeof issue?.code === 'string' &&
        /^GAME-[A-Z]{2,16}-\d{3}$/.test(issue.code)
          ? issue.code
          : undefined;
      fail(new Error('Game reported issue'), callback, { customCode });
    },
  });
  Object.defineProperty(window, 'GameJamMultiplayer', {
    value: api,
    writable: false,
    configurable: false,
  });
  window.addEventListener('message', (event) => {
    if (
      event.source !== window.parent ||
      event.data?.type !== 'gamejam:connect' ||
      event.data.id !== config.id ||
      !event.ports[0] ||
      port
    )
      return;
    port = event.ports[0];
    port.onmessage = (event) => receive(event.data);
    port.start();
    if (pendingFailure) send(pendingFailure);
    else if (adapter) send({ type: 'loaded' });
  });
  window.addEventListener('blur', () => {
    keys = {};
    if (context?.solo) inputs.clear();
  });
  let lastInput = 0;
  setInterval(() => {
    if (!active || !adapter || !context) return;
    try {
      const now = performance.now();
      if (context.solo)
        receive({
          type: 'input',
          playerId: 'solo',
          sequence: ++inputSeq,
          input: keys,
        });
      if (!context.solo && now - lastInput >= 32) {
        lastInput = now;
        send({ type: 'input', sequence: ++inputSeq, input: keys });
      }
      if (!context.host) return;
      const current = context.players.map((player) => {
        const item = inputs.get(player.id);
        return {
          playerId: player.id,
          input: item && now - item.at < 250 ? item.input : {},
          fresh: !!item?.fresh,
          sequence: item?.sequence || 0,
        };
      });
      const next = invoke('step', () =>
        adapter.step(state, {
          inputs: current,
          dt: 1 / 30,
          tick,
          players: context.players,
          random,
          solo: context.solo,
        }),
      );
      if (next !== undefined) state = next;
      for (const item of inputs.values()) item.fresh = false;
      tick++;
      renderState = invoke('serialize', () => gameCopy(state));
      if (!context.solo && now - lastSnapshot >= 50) {
        lastSnapshot = now;
        invoke('serialize', () => {
          const value = snapshot();
          value.emission = stateSeq + 1;
          const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
          if (bytes > 32768) {
            fail(new RangeError('State size'), 'serialize', {
              bytes,
              limit: 32768,
            });
            return;
          }
          send({ type: 'snapshot', sequence: ++stateSeq, snapshot: value });
        });
      }
      const outcome = invoke('getOutcome', () => adapter.getOutcome(state));
      if (outcome !== null && outcome !== undefined) {
        active = false;
        if (!context.solo)
          invoke('getOutcome', () =>
            send({
              type: 'finish',
              snapshot: snapshot(),
              outcome: gameCopy(outcome),
            }),
          );
      }
    } catch (error) {
      fail(error);
    }
  }, 1000 / 30);
  function draw() {
    try {
      if (!broken && adapter && renderState !== undefined && context)
        invoke('render', () =>
          adapter.render(copy(renderState), {
            selfId: context.selfId,
            solo: context.solo,
            interpolation: 1,
            active,
          }),
        );
    } catch (error) {
      fail(error);
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}
