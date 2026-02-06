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
    } else if (msg.type === 'settlement_update') {
      settlement = msg.payload;
      if (!$('settleModal').hidden) openSettlement();
    } else if (msg.type === 'session_cleared') {
      settlement = null;
      closeSettlement();
      showError($('tableErr'), 'settlement cleared');
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

function renderCard(card) {
  if (!card) return '';
  const r = card[0];
  const s = card[1];
  const suit = s === 's' ? '♠' : s === 'h' ? '♥' : s === 'd' ? '♦' : s === 'c' ? '♣' : s;
  return `${r}${suit}`;
}

function seatPositions() {
  // 8 seats around an oval (percent positions)
  return [
    { seat: 1, x: 50, y: 8 },
    { seat: 2, x: 76, y: 16 },
    { seat: 3, x: 92, y: 40 },
    { seat: 4, x: 76, y: 82 },
    { seat: 5, x: 50, y: 92 },
    { seat: 6, x: 24, y: 82 },
    { seat: 7, x: 8, y: 40 },
    { seat: 8, x: 24, y: 16 }
  ];
}

function openSettlement() {
  if (!settlement) return;

  const transfers = settlement.transfers || [];
  const lines = transfers.length
    ? `<ol>${transfers.map(t => `<li><strong>${t.from}</strong> owes <strong>${t.to}</strong> <span class="chips">${t.amount}</span></li>`).join('')}</ol>`
    : `<div class="muted">No one owes anyone anything.</div>`;

  const entries = settlement.entries || [];
  const rows = entries.length
    ? `<table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="text-align:left;border-bottom:1px solid var(--border);padding:6px 0">player</th>
            <th style="text-align:right;border-bottom:1px solid var(--border);padding:6px 0">start</th>
            <th style="text-align:right;border-bottom:1px solid var(--border);padding:6px 0">end</th>
            <th style="text-align:right;border-bottom:1px solid var(--border);padding:6px 0">net</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map(e => {
            const net = e.net || 0;
            const netStr = net > 0 ? `+${net}` : `${net}`;
            return `<tr>
              <td style="padding:6px 0"><strong>${e.username}</strong></td>
              <td style="padding:6px 0;text-align:right">${e.start}</td>
              <td style="padding:6px 0;text-align:right">${e.end}</td>
              <td style="padding:6px 0;text-align:right"><span class="chips">${netStr}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`
    : '';

  const started = settlement.startedAt ? new Date(settlement.startedAt).toLocaleString() : '—';
  const ended = settlement.endedAt ? new Date(settlement.endedAt).toLocaleString() : '—';

  $('settleBody').innerHTML = `
    <div class="muted">room: <code>${settlement.roomId}</code></div>
    <div class="muted">started: ${started}</div>
    <div class="muted">as of: ${ended}</div>
    <hr style="border:0;border-top:1px solid var(--border);margin:14px 0" />
    <h3 style="margin:0 0 8px 0">who owes who</h3>
    ${lines}
    <hr style="border:0;border-top:1px solid var(--border);margin:14px 0" />
    <h3 style="margin:0 0 8px 0">ledger</h3>
    ${rows}
  `;

  $('settleModal').hidden = false;
}

function isPdfLibReady() {
  return typeof window !== 'undefined'
    && window.html2canvas
    && window.jspdf
    && window.jspdf.jsPDF;
}

async function downloadSettlementPdf() {
  if (!settlement) return;
  const el = $('settleModal');
  if (!el || el.hidden) return;

  if (!isPdfLibReady()) {
    showError($('tableErr'), 'pdf libs still loading—try again in a second');
    return;
  }

  const prevHidden = el.hidden;
  el.hidden = false;

  try {
    const canvas = await window.html2canvas(el, {
      backgroundColor: '#ffffff',
      scale: Math.min(2, window.devicePixelRatio || 1),
      useCORS: true
    });

    const imgData = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;

    const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const margin = 28;
    const targetWidth = pageWidth - margin * 2;
    const scale = targetWidth / canvas.width;
    const targetHeight = canvas.height * scale;

    let remaining = targetHeight;
    let offsetY = 0;

    while (remaining > 0) {
      pdf.addImage(imgData, 'PNG', margin, margin - offsetY, targetWidth, targetHeight);
      remaining -= (pageHeight - margin * 2);
      offsetY += (pageHeight - margin * 2);
      if (remaining > 0) pdf.addPage();
    }

    const safeRoom = String(settlement.roomId || 'room').replace(/[^a-z0-9_-]+/gi, '_');
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    pdf.save(`poker-settlement-${safeRoom}-${ts}.pdf`);
  } catch (e) {
    showError($('tableErr'), e?.message || 'pdf_failed');
  } finally {
    el.hidden = prevHidden;
  }
}

function closeSettlement() {
  $('settleModal').hidden = true;
}

function render() {
  // Preserve the raise input value/focus across re-renders.
  // The server can send frequent snapshots; rebuilding the actions DOM would otherwise
  // kick you out of the input while typing.
  const prevRaise = $('raiseTo');
  const prevRaiseValue = prevRaise ? prevRaise.value : '';
  const prevRaiseFocused = prevRaise && document.activeElement === prevRaise;
  const prevSelStart = prevRaiseFocused ? prevRaise.selectionStart : null;
  const prevSelEnd = prevRaiseFocused ? prevRaise.selectionEnd : null;

  $('loginCard').hidden = !!me;
  $('lobbyCard').hidden = !me;
  $('tableCard').hidden = !(me && roomId);

  setMe();

  if (!snapshot?.game) {
    $('board').innerHTML = '';
    $('pot').textContent = '';
  }

  if (snapshot?.game) {
    $('board').innerHTML = snapshot.game.board.map(c => `<div class="cardFace">${renderCard(c)}</div>`).join('') || '<div class="muted">(no board yet)</div>';
    $('pot').textContent = `pot: ${snapshot.game.pot}`;
  }

  const seatMap = new Map((snapshot?.seats || []).map(s => [s.seat, s.username]));
  const playersByName = new Map((snapshot?.game?.players || []).map(p => [p.username, p]));

  const host = snapshot?.host;
  $('hostNote').textContent = host ? `(host: ${host})` : '';

  const isHost = host && host === me;
  $('startSessionBtn').disabled = !isHost;
  $('endSessionBtn').disabled = !isHost;
  const resetBtn = $('resetSessionBtn');
  if (resetBtn) resetBtn.disabled = !isHost;

  const pos = seatPositions();
  const ring = pos.map(({ seat, x, y }) => {
    const u = seatMap.get(seat);
    const p = u ? playersByName.get(u) : null;
    const isYou = u === me;

    const hole = p?.hole ? p.hole.map(renderCard).join(' ') : (p && p.hole === null ? '?? ??' : '');
    const flags = [];
    if (snapshot?.game?.toAct === u) flags.push('TO ACT');
    if (snapshot?.game?.dealerSeat === seat) flags.push('DEALER');
    if (p?.folded) flags.push('FOLDED');
    if (p?.allIn) flags.push('ALL-IN');

    const action = u
      ? `<span class="badge">${seat}</span>`
      : `<button data-sit="${seat}">sit</button>`;

    const body = u
      ? `<div class="small">stack: <span class=chips>${p?.stack ?? '—'}</span>\nbet: ${p?.bet ?? 0}\n</div><div class="cards">${hole}</div><div class="small">${flags.length ? flags.join(' • ') : ''}</div>`
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

  // Restore raise input value + cursor if we had it focused.
  const newRaise = $('raiseTo');
  if (newRaise && prevRaiseValue && !newRaise.value) newRaise.value = prevRaiseValue;
  if (newRaise && prevRaiseFocused) {
    newRaise.focus();
    if (typeof prevSelStart === 'number' && typeof prevSelEnd === 'number') {
      try { newRaise.setSelectionRange(prevSelStart, prevSelEnd); } catch {}
    }
  }
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

$('resetSessionBtn')?.addEventListener('click', () => {
  showError($('tableErr'), '');
  if (!confirm('Reset settlement for this room? This clears the session baseline/ledger.')) return;
  send('reset_session');
});

$('closeSettleBtn').addEventListener('click', () => closeSettlement());
$('printSettleBtn').addEventListener('click', () => window.print());
$('downloadPdfBtn').addEventListener('click', () => downloadSettlementPdf());

// bootstrap from localStorage
(() => {
  const u = localStorage.getItem('poker_username');
  const r = localStorage.getItem('poker_room');
  if (u) $('username').value = u;
  if (r) $('roomId').value = r;
})();

render();
