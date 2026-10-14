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
  const send = (message) => port?.postMessage(message);
  const fail = (error) => {
    if (broken) return;
    broken = true;
    active = false;
    send({
      type: 'error',
      message: String(error?.message || error).slice(0, 300),
    });
    console.error('Game Jam! multiplayer:', String(error?.message || error));
  };
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
      state = adapter.createState({
        players: context.players,
        seed: context.seed,
        random,
        solo: context.solo,
      });
      renderState = copy(state);
    }
    active = context.solo;
    send({ type: 'begun' });
    if (context.host && !context.solo)
      send({ type: 'snapshot', sequence: ++stateSeq, snapshot: snapshot() });
  }
  function receive(message) {
    try {
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
        if (adapter.validateInput(message.input) !== true) return;
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
    },
    sendInput(input) {
      if (!active || !context) return;
      keys = copy(input);
      if (context.solo)
        receive({
          type: 'input',
          playerId: 'solo',
          sequence: ++inputSeq,
          input: keys,
        });
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
    if (adapter) send({ type: 'loaded' });
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
      const next = adapter.step(state, {
        inputs: current,
        dt: 1 / 30,
        tick,
        players: context.players,
        random,
        solo: context.solo,
      });
      if (next !== undefined) state = next;
      for (const item of inputs.values()) item.fresh = false;
      tick++;
      renderState = copy(state);
      if (!context.solo && now - lastSnapshot >= 50) {
        lastSnapshot = now;
        send({ type: 'snapshot', sequence: ++stateSeq, snapshot: snapshot() });
      }
      const outcome = adapter.getOutcome(state);
      if (outcome !== null && outcome !== undefined) {
        active = false;
        if (!context.solo)
          send({ type: 'finish', snapshot: snapshot(), outcome });
      }
    } catch (error) {
      fail(error);
    }
  }, 1000 / 30);
  function draw() {
    try {
      if (!broken && adapter && renderState !== undefined && context)
        adapter.render(copy(renderState), {
          selfId: context.selfId,
          solo: context.solo,
          interpolation: 1,
          active,
        });
    } catch (error) {
      fail(error);
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}
