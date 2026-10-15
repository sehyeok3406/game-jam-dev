import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { validateMultiplayerHtml } from '../src/multiplayer/contract.ts';
import { multiplayerInstructions } from '../src/multiplayer/generation.ts';
import { DEFAULT_MULTIPLAYER } from '../src/multiplayer/types.ts';

const html = fs.readFileSync(
  new URL('../examples/multiplayer-push.html', import.meta.url),
  'utf8',
);
function game(solo = false) {
  let adapter;
  const sent = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    beforeParse(window) {
      window.GameJamMultiplayer = {
        register: (value) => {
          adapter = value;
        },
        sendInput: (value) => sent.push(value),
      };
      window.RTCPeerConnection = function () {
        throw Error('The game must use the app connection');
      };
      window.HTMLCanvasElement.prototype.getContext = () =>
        new Proxy({}, { get: () => () => {} });
    },
  });
  const state = adapter.createState({
    players: [{ id: 'a' }, ...(solo ? [] : [{ id: 'b' }])],
    solo,
  });
  const tick = (commands = [], dt = 1 / 30) =>
    adapter.step(state, {
      dt,
      inputs: commands.map(([playerId, input]) => ({ playerId, input })),
    });
  const render = (selfId = 'a', active = true) =>
    adapter.render(state, { selfId, active, solo });
  return { adapter, dom, state, sent, tick, render };
}

test('push game reserves seats atomically, starts with both players, and renders plain instructions', () => {
  assert.equal(validateMultiplayerHtml(html).maxPlayers, 2);
  const { dom, state, tick, render } = game();
  try {
    render();
    assert.equal(dom.window.document.getElementById('seat-0').disabled, false);
    tick([
      ['a', { seat: 0 }],
      ['b', { seat: 0 }],
      ['stranger', { seat: 1 }],
    ]);
    assert.deepEqual(Array.from(state.owners), ['a', null]);
    assert.equal(state.stage, 'choose');
    render('b');
    assert.equal(dom.window.document.getElementById('seat-0').disabled, true);
    assert.equal(dom.window.document.getElementById('seat-1').disabled, false);
    tick([['b', { seat: 1 }]]);
    assert.equal(state.stage, 'play');
    render();
    assert.equal(dom.window.document.getElementById('play').hidden, false);
    assert.equal(dom.window.document.getElementById('choose').hidden, true);
    assert.match(
      dom.window.document.getElementById('who').textContent,
      /1P로 플레이/,
    );
    assert(
      !/SDK|JSON|ICE|STUN|TURN|WebRTC/.test(
        dom.window.document.querySelector('main').textContent,
      ),
    );
    assert.equal(
      dom.window.document.querySelectorAll('textarea,input').length,
      0,
    );
  } finally {
    dom.window.close();
  }
});

test('push game moves only the input owner, normalizes diagonals, clamps walls, and does not repeat a push', () => {
  const { adapter, dom, state, tick } = game();
  try {
    tick([
      ['a', { seat: 0 }],
      ['b', { seat: 1 }],
    ]);
    const start = { x: state.circles[0].x, y: state.circles[0].y };
    tick([['a', { x: -1, y: -1 }]]);
    assert(
      Math.abs(
        Math.hypot(state.circles[0].x - start.x, state.circles[0].y - start.y) -
          190 / 30,
      ) < 1e-8,
    );
    assert.equal(state.circles[1].x, 420);
    assert.equal(adapter.validateInput({ x: 4 }), false);
    state.circles[0].x = 350;
    state.circles[0].y = 250;
    state.circles[0].dx = 1;
    state.circles[0].dy = 0;
    tick([['a', { pushId: 1 }]]);
    assert.equal(state.circles[1].vx, 600);
    assert.equal(state.circles[0].cooldown, 1);
    for (let n = 0; n < 65; n++) tick([['a', { pushId: 1 }]]);
    assert.equal(
      state.circles[0].cooldown,
      0,
      'held/retransmitted push does not fire again',
    );
    state.circles[1].x = 420;
    tick([['a', { pushId: 2 }]]);
    assert.equal(state.circles[0].cooldown, 1);
    assert(state.circles[1].vx > 599);
    for (let n = 0; n < 200; n++) tick([['a', { x: -1, y: -1 }]]);
    assert.equal(state.circles[0].x, 20);
    assert.equal(state.circles[0].y, 20);
    assert.equal(adapter.getOutcome(state), null);
  } finally {
    dom.window.close();
  }
});

test('solo practice uses either seat with a stationary target and restores push input after reload', () => {
  const { dom, state, sent, tick, render } = game(true);
  try {
    render();
    dom.window.document.getElementById('seat-1').click();
    assert.equal(sent.at(-1).seat, 1);
    tick([['a', sent.at(-1)]]);
    assert.equal(state.stage, 'play');
    assert.deepEqual(Array.from(state.owners), [null, 'a']);
    const target = { ...state.circles[0] };
    tick();
    assert.equal(state.circles[0].x, target.x);
    state.people[0].pushId = 90;
    render();
    dom.window.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { code: 'Space' }),
    );
    assert.equal(sent.at(-1).pushId, 91);
    dom.window.dispatchEvent(new dom.window.Event('blur'));
    assert.equal(sent.at(-1).x, 0);
    render('a', false);
    assert.match(
      dom.window.document.getElementById('cooldown').textContent,
      /잠시 멈췄어요/,
    );
  } finally {
    dom.window.close();
  }
});

test('generation forbids invented code-exchange fallback and keeps technical connection settings out of player UI', () => {
  const instructions = multiplayerInstructions(DEFAULT_MULTIPLAYER);
  assert.match(instructions, /RTCPeerConnection/);
  assert.match(instructions, /수동 연결 코드 교환/);
  assert.match(instructions, /설정을 구현하지 않는다/);
  assert.match(
    instructions,
    /전문 용어나 연결 코드·서버 설정 입력을 노출하지 않는다/,
  );
  assert.match(instructions, /자리 선택·중복 선택 거절/);
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  try {
    assert.match(
      dom.window.document.getElementById('hint').textContent,
      /앱에 가져와 열어주세요/,
    );
    assert.equal(dom.window.document.getElementById('seat-0').disabled, true);
  } finally {
    dom.window.close();
  }
});
