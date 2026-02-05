// GitHub Pages frontend -> Fly backend
const BACKEND_ORIGIN = 'https://mootvey-poker.fly.dev';

let me = null;
let chips = null;
let roomId = null;
let ws = null;
let snapshot = null;

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

  let html = '';
  for (let s = 1; s <= 9; s++) {
    const u = seatMap.get(s);
    const p = u ? playersByName.get(u) : null;
    const isYou = u === me;

    const hole = p?.hole ? p.hole.join(' ') : (p && p.hole === null ? '?? ??' : '');
    const flags = [];
    if (snapshot?.game?.toAct === u) flags.push('TO ACT');
    if (snapshot?.game?.dealerSeat === s) flags.push('DEALER');
    if (p?.folded) flags.push('FOLDED');
    if (p?.allIn) flags.push('ALL-IN');

    html += `
      <div class="seat ${isYou ? 'you' : ''}">
        <div class="seatTop">
          <div>${u ? `<strong>${u}</strong>` : `<span class="muted">seat ${s}</span>`}</div>
          <div>${u ? `<span class="badge">${s}</span>` : `<button data-sit="${s}">sit</button>`}</div>
        </div>
        <div class="small">${u ? `stack: <span class=chips>${p?.stack ?? '—'}</span>\n` : ''}${u ? `bet: ${p?.bet ?? 0}\n` : ''}${u ? `cards: ${hole}\n` : ''}${flags.length ? flags.join(' • ') : ''}</div>
      </div>
    `;
  }
  $('seats').innerHTML = html;

  const g = snapshot?.game;
  const you = g?.players?.find(p => p.username === me);
  const isYourTurn = g?.toAct === me;

  let a = '';
  if (!g) {
    a = '<div class="muted">no hand running.</div>';
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

// bootstrap from localStorage
(() => {
  const u = localStorage.getItem('poker_username');
  const r = localStorage.getItem('poker_room');
  if (u) $('username').value = u;
  if (r) $('roomId').value = r;
})();

render();
