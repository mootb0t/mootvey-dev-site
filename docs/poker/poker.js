// GitHub Pages frontend -> Fly backend
const BACKEND_ORIGIN = 'https://mootvey-poker.fly.dev';

let me = null;
let chips = null;
let roomId = null;
let ws = null;
let snapshot = null;
let settlement = null;

const $ = (id) => document.getElementById(id);

function showError(el, msg) {
  el.textContent = msg || '';
}

function setMe() {
  $('me').textContent = me ? `you: ${me}\nchips: ${chips}` : '';
}

async function apiPost(path, body) {
  const res = await fetch(`${BACKEND_ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'request_failed');
  return data;
}

async function apiLogin(username) {
  return apiPost('/api/login', { username });
}

async function apiTopup(username, amount) {
  return apiPost('/api/topup', { username, amount });
}

function connectWs() {
  if (!me || !roomId) return;
  if (ws) ws.close();

  ws = new WebSocket(`wss://mootvey-poker.fly.dev/?u=${encodeURIComponent(me)}&r=${encodeURIComponent(roomId)}`);

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'room_snapshot') {
      snapshot = msg.payload;
      render();
    } else if (msg.type === 'settlement') {
      settlement = msg.payload;
      openSettlement();
    } else if (msg.type === 'error') {
      showError($('tableErr'), msg.payload?.error || 'error');
    }
  };

  ws.onclose = () => {
    setTimeout(() => {
      if (me && roomId) connectWs();
    }, 900);
  };
}

function send(type, payload = {}) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type, ...payload }));
}

function seatPositions() {
  // 9 seats around an oval (percent positions)
  return [
    { seat: 1, x: 50, y: 10 },
    { seat: 2, x: 75, y: 18 },
    { seat: 3, x: 90, y: 40 },
    { seat: 4, x: 75, y: 78 },
    { seat: 5, x: 50, y: 90 },
    { seat: 6, x: 25, y: 78 },
    { seat: 7, x: 10, y: 40 },
    { seat: 8, x: 25, y: 18 },
    { seat: 9, x: 50, y: 50 } // center-ish spare seat
  ];
}

function openSettlement() {
  if (!settlement) return;

  const transfers = settlement.transfers || [];
  const lines = transfers.length
    ? `<ol>${transfers.map(t => `<li><strong>${t.from}</strong> owes <strong>${t.to}</strong> <span class="chips">${t.amount}</span></li>`).join('')}</ol>`
    : `<div class="muted">No one owes anyone anything.</div>`;

  const started = settlement.startedAt ? new Date(settlement.startedAt).toLocaleString() : '—';
  const ended = settlement.endedAt ? new Date(settlement.endedAt).toLocaleString() : '—';

  $('settleBody').innerHTML = `
    <div class="muted">room: <code>${settlement.roomId}</code></div>
    <div class="muted">started: ${started}</div>
    <div class="muted">ended: ${ended}</div>
    <hr style="border:0;border-top:1px solid var(--border);margin:14px 0" />
    <h3 style="margin:0 0 8px 0">who owes who</h3>
    ${lines}
  `;

  $('settleModal').hidden = false;
}

function closeSettlement() {
  $('settleModal').hidden = true;
}

function render() {
  $('loginCard').hidden = !!me;
  $('lobbyCard').hidden = !me;
  $('tableCard').hidden = !(me && roomId);

  setMe();

  if (!snapshot?.game) {
    $('board').innerHTML = '';
    $('pot').textContent = '';
  }

  if (snapshot?.game) {
    $('board').innerHTML = snapshot.game.board.map(c => `<div class="cardFace">${c}</div>`).join('') || '<div class="muted">(no board yet)</div>';
    $('pot').textContent = `pot: ${snapshot.game.pot}`;
  }

  const seatMap = new Map((snapshot?.seats || []).map(s => [s.seat, s.username]));
  const playersByName = new Map((snapshot?.game?.players || []).map(p => [p.username, p]));

  const host = snapshot?.host;
  $('hostNote').textContent = host ? `(host: ${host})` : '';

  const isHost = host && host === me;
  $('startSessionBtn').disabled = !isHost;
  $('endSessionBtn').disabled = !isHost;

  const pos = seatPositions();
  const ring = pos.map(({ seat, x, y }) => {
    const u = seatMap.get(seat);
    const p = u ? playersByName.get(u) : null;
    const isYou = u === me;

    const hole = p?.hole ? p.hole.join(' ') : (p && p.hole === null ? '?? ??' : '');
    const flags = [];
    if (snapshot?.game?.toAct === u) flags.push('TO ACT');
    if (snapshot?.game?.dealerSeat === seat) flags.push('DEALER');
    if (p?.folded) flags.push('FOLDED');
    if (p?.allIn) flags.push('ALL-IN');

    const action = u
      ? `<span class="badge">${seat}</span>`
      : `<button data-sit="${seat}">sit</button>`;

    const body = u
      ? `<div class="small">stack: <span class=chips>${p?.stack ?? '—'}</span>\nbet: ${p?.bet ?? 0}\ncards: ${hole}\n${flags.length ? flags.join(' • ') : ''}</div>`
      : `<div class="small muted">empty seat</div>`;

    return `
      <div class="seatBubble ${isYou ? 'you' : ''}" style="left:${x}%;top:${y}%;">
        <div class="seatName">
          <div>${u ? `<strong>${u}</strong>` : `<span class="muted">seat ${seat}</span>`}</div>
          <div>${action}</div>
        </div>
        ${body}
      </div>
    `;
  }).join('');

  $('seatRing').innerHTML = ring;

  const g = snapshot?.game;
  const you = g?.players?.find(p => p.username === me);
  const isYourTurn = g?.toAct === me;

  let a = '';
  if (!g) {
    a = '<div class="muted">no hand running.</div>';
  } else if (g.phase === 'showdown') {
    const note = g.lastResult?.note ? `<div class="muted">${g.lastResult.note}</div>` : '';
    const winners = g.lastResult?.winners?.length ? `<div class="muted">winners: ${g.lastResult.winners.join(', ')}</div>` : '';
    a = `${note}${winners}<div class="muted">host can start the next hand.</div>`;
  } else if (!isYourTurn) {
    a = '<div class="muted">waiting…</div>';
  } else if (you?.folded) {
    a = '<div class="muted">you folded.</div>';
  } else {
    const toCall = Math.max(0, (g.currentBet || 0) - (you?.bet || 0));
    a += `<button id="foldBtn">fold</button>`;
    a += `<button id="callBtn">${toCall === 0 ? 'check' : `call ${toCall}`}</button>`;
    a += `<input id="raiseTo" placeholder="raise to" inputmode="numeric" style="min-width:140px" />`;
    a += `<button id="raiseBtn">raise</button>`;
  }
  $('actions').innerHTML = a;

  document.querySelectorAll('[data-sit]').forEach(btn => {
    btn.addEventListener('click', () => send('sit', { seat: Number(btn.getAttribute('data-sit')) }));
  });

  const foldBtn = $('foldBtn');
  if (foldBtn) foldBtn.onclick = () => send('action', { action: { type: 'fold' } });

  const callBtn = $('callBtn');
  if (callBtn) callBtn.onclick = () => send('action', { action: { type: 'check_call' } });

  const raiseBtn = $('raiseBtn');
  if (raiseBtn) raiseBtn.onclick = () => {
    const totalTo = Number(($('raiseTo')?.value || '').trim());
    send('action', { action: { type: 'bet_raise', totalTo } });
  };
}

$('loginBtn').addEventListener('click', async () => {
  showError($('loginErr'), '');
  const username = $('username').value.trim();
  try {
    const res = await apiLogin(username);
    me = res.username;
    chips = res.chips;
    localStorage.setItem('poker_username', me);
    render();
  } catch (e) {
    showError($('loginErr'), e.message);
  }
});

$('joinRoomBtn').addEventListener('click', () => {
  showError($('tableErr'), '');
  const r = $('roomId').value.trim();
  if (!r) return;
  roomId = r;
  localStorage.setItem('poker_room', roomId);
  connectWs();
  render();
});

$('topupBtn').addEventListener('click', async () => {
  showError($('topupErr'), '');
  if (!me) return;
  const amount = Number(($('topupAmount').value || '').trim());
  try {
    const res = await apiTopup(me, amount);
    chips = res.chips;
    setMe();
  } catch (e) {
    showError($('topupErr'), e.message);
  }
});

$('startHandBtn').addEventListener('click', () => {
  showError($('tableErr'), '');
  send('start_hand');
});

$('startSessionBtn').addEventListener('click', () => {
  showError($('tableErr'), '');
  send('start_session');
});

$('endSessionBtn').addEventListener('click', () => {
  showError($('tableErr'), '');
  send('end_session');
});

$('closeSettleBtn').addEventListener('click', () => closeSettlement());
$('printSettleBtn').addEventListener('click', () => window.print());

// bootstrap from localStorage
(() => {
  const u = localStorage.getItem('poker_username');
  const r = localStorage.getItem('poker_room');
  if (u) $('username').value = u;
  if (r) $('roomId').value = r;
})();

render();
