const socket = io();
const app = document.getElementById('app');
const toast = document.getElementById('toast');

let state = {
  playerId: null,
  lobby: null,
  currentGame: null,
  submitted: false,
  timers: new Set(),
};

const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const isHost = () => state.lobby && state.lobby.hostId === socket.id;
const me = () => state.lobby?.players.find((p) => p.id === socket.id);

function clearTimers() {
  for (const t of state.timers) clearTimeout(t);
  state.timers.clear();
}
function later(fn, ms) {
  const t = setTimeout(() => { state.timers.delete(t); fn(); }, ms);
  state.timers.add(t);
  return t;
}
function showToast(message, ms = 2200) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  later(() => toast.classList.add('hidden'), ms);
}
function emitAck(event, payload = {}) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}
function setScreenMode(mode = 'panel') {
  app.className = mode === 'arena' ? 'arena-shell' : 'shell';
  document.body.classList.toggle('arena-mode', mode === 'arena');
}
function panel(content, status = 'ONLINE') {
  setScreenMode('panel');
  return `
    <section class="panel">
      <div class="topbar"><div class="brand">MINIGAME ARENA</div><div class="status">${esc(status)}</div></div>
      <div class="panel-inner">${content}</div>
    </section>`;
}

function renderHome() {
  clearTimers();
  state.currentGame = null;
  app.innerHTML = panel(`
    <div class="kicker">HOSTED MULTIPLAYER // 2-20 PLAYERS</div>
    <h1>MINIGAME<br>ARENA</h1>
    <p class="subtle">Four rounds. Eight games. One lobby code. Extremely normal friendship damage.</p>
    <div class="divider"></div>
    <div class="grid-2">
      <div class="stack">
        <label>PLAYER NAME
          <input id="name" maxlength="24" placeholder="Player Name" autocomplete="nickname" />
        </label>
        <button class="btn big" id="create">CREATE LOBBY</button>
      </div>
      <div class="stack">
        <label>LOBBY CODE
          <input id="code" maxlength="5" placeholder="ABCDE" autocomplete="off" />
        </label>
        <button class="btn big" id="join">JOIN LOBBY</button>
      </div>
    </div>
  `, socket.connected ? 'CONNECTED' : 'CONNECTING');

  document.getElementById('create').onclick = async () => {
    const name = document.getElementById('name').value;
    const res = await emitAck('lobby:create', { name });
    if (!res.ok) return showToast(res.error);
    state.playerId = res.playerId;
  };
  document.getElementById('join').onclick = async () => {
    const name = document.getElementById('name').value;
    const code = document.getElementById('code').value;
    const res = await emitAck('lobby:join', { name, code });
    if (!res.ok) return showToast(res.error);
    state.playerId = res.playerId;
  };
}

function renderLobby() {
  if (!state.lobby) return renderHome();
  clearTimers();
  const l = state.lobby;
  const players = l.players.filter((p) => p.connected);
  const playerRows = players.map((p, i) => `
    <div class="player-row ${p.id === socket.id ? 'me' : ''} ${p.id === l.hostId ? 'host' : ''}">
      <div class="rank">${String(i + 1).padStart(2, '0')}</div>
      <div>${esc(p.name)}</div>
      <div class="badge">${p.id === l.hostId ? 'HOST' : 'PLAYER'}</div>
      ${isHost() && p.id !== socket.id ? `<button class="btn ghost kick" data-id="${p.id}">KICK</button>` : '<span></span>'}
    </div>
  `).join('');

  app.innerHTML = panel(`
    <div class="grid-2">
      <div>
        <div class="kicker">LOBBY CODE</div>
        <div class="code">${esc(l.code)}</div>
        <p class="subtle" style="margin-top:14px">Share this code. People join from the public site. No invitation ceremony required.</p>
      </div>
      <div class="stack">
        <div class="row spread"><span>PLAYERS</span><strong>${players.length}/20</strong></div>
        <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, players.length / 20 * 100)}%"></div></div>
        ${isHost() ? `
          <button class="btn big" id="start" ${players.length < 2 ? 'disabled' : ''}>START GAME</button>
          <button class="btn ghost" id="lock">${l.locked ? 'UNLOCK LOBBY' : 'LOCK LOBBY'}</button>
        ` : `<div class="badge">WAITING FOR HOST</div>`}
        <button class="btn ghost" id="leave">LEAVE LOBBY</button>
      </div>
    </div>
    <div class="divider"></div>
    <div class="player-list">${playerRows || '<div class="subtle">NO PLAYERS</div>'}</div>
  `, l.locked ? 'LOBBY LOCKED' : 'WAITING ROOM');

  document.getElementById('leave').onclick = () => { socket.emit('lobby:leave'); state.lobby = null; renderHome(); };
  if (isHost()) {
    document.getElementById('start').onclick = async () => {
      const res = await emitAck('match:start');
      if (!res.ok) showToast(res.error);
    };
    document.getElementById('lock').onclick = async () => {
      const res = await emitAck('lobby:toggleLock');
      if (!res.ok) showToast(res.error);
    };
    document.querySelectorAll('.kick').forEach((b) => b.onclick = async () => {
      const res = await emitAck('lobby:kick', { playerId: b.dataset.id });
      if (!res.ok) showToast(res.error);
    });
  }
}

function renderRoundIntro(data) {
  clearTimers();
  const games = data.games.map((g) => `<div class="badge">${esc(g)}</div>`).join(' ');
  app.innerHTML = panel(`
    <div class="round-title">
      <div class="kicker">${data.isFinal ? 'MINIGAME ARENA' : 'ROUND'}</div>
      <div class="round-number">${String(data.round).padStart(2, '0')}</div>
      <h2>${data.isFinal ? 'FINAL ROUND' : `${data.activePlayers} PLAYERS REMAIN`}</h2>
      ${data.isFinal ? `<p class="subtle">Arena points reset to zero. Highest final score wins.</p>` : `<p class="subtle">TOP ${data.qualificationTarget} ADVANCE AFTER THIS ROUND.</p>`}
      <div class="row" style="justify-content:center">${games}</div>
      <div style="height:24px"></div>
      ${isHost() ? `<button class="btn big" id="go">START ROUND</button>` : `<div class="badge">WAITING FOR HOST</div>`}
    </div>
  `, data.isFinal ? 'FINAL' : `ROUND ${data.round}`);
  if (isHost()) document.getElementById('go').onclick = async () => {
    const res = await emitAck('match:startRoundGames');
    if (!res.ok) showToast(res.error);
  };
}

function gameFrame(title, sub, body) {
  setScreenMode('arena');
  app.innerHTML = `
    <section class="arena-screen">
      <div class="arena-topbar">
        <div>
          <div class="kicker">${esc(sub)}</div>
          <div class="game-title">${esc(title)}</div>
        </div>
        <div class="badge" id="submitStatus">PLAYING</div>
      </div>
      <div class="arena-stage game-stage" id="stage">${body}</div>
      <div class="arena-footer">
        <div class="subtle">RESULTS SUBMIT AUTOMATICALLY</div>
        <div id="submissionCount" class="subtle"></div>
      </div>
    </section>`;
}

function renderGameCutscene(data) {
  clearTimers();
  state.currentGame = null;
  setScreenMode('arena');
  const instructions = {
    'flash-memory': 'MEMORIZE THE LIT CELLS. REBUILD THE PATTERN.',
    bullseye: 'HIT AS MANY TARGETS AS POSSIBLE BEFORE TIME EXPIRES.',
    sequence: 'WATCH THE PATTERN. REPEAT IT IN THE SAME ORDER.',
    red: 'WAIT FOR GO. CLICKING EARLY IS A FALSE START.',
    'bomb-pass': 'THE FUSE IS HIDDEN. PASS THE BOMB. DO NOT BE HOLDING IT.',
    'color-clash': 'CHOOSE THE INK COLOR. IGNORE THE WORD.',
    estimate: 'STOP THE HIDDEN TIMER AS CLOSE TO THE TARGET AS POSSIBLE.',
    'count-up': 'WATCH EVERY SHAPE. COUNT ONLY THE ONE YOU ARE ASKED FOR.',
  };
  app.innerHTML = `
    <section class="cutscene-screen">
      <div class="cutscene-grid" aria-hidden="true"></div>
      <div class="cutscene-content">
        <div class="cutscene-label">ROUND ${String(data.round).padStart(2,'0')} // GAME ${data.roundGameNumber}/${data.roundGameTotal}</div>
        <div class="cutscene-rule"></div>
        <div class="cutscene-small">NEXT MINIGAME</div>
        <div class="cutscene-title">${esc(data.name)}</div>
        <p class="cutscene-instruction">${esc(instructions[data.id] || 'GET READY.')}</p>
        <div class="cutscene-count" id="cutsceneCount">03</div>
      </div>
    </section>`;
  const counter = document.getElementById('cutsceneCount');
  later(() => { if (counter) counter.textContent = '02'; }, 1000);
  later(() => { if (counter) counter.textContent = '01'; }, 2000);
  later(() => { if (counter) { counter.textContent = 'READY'; counter.classList.add('ready'); } }, 3000);
}

function submitGame(raw, detail = null) {
  if (state.submitted) return;
  state.submitted = true;
  const el = document.getElementById('submitStatus');
  if (el) el.textContent = 'SUBMITTED';
  socket.emit('game:submit', { raw, detail }, (res) => {
    if (!res?.ok) showToast(res?.error || 'Could not submit result.');
  });
}

function playGame(data) {
  clearTimers();
  state.currentGame = data;
  state.submitted = false;
  const fn = {
    'flash-memory': playFlashMemory,
    bullseye: playBullseye,
    sequence: playSequence,
    red: playRed,
    'bomb-pass': playBombPass,
    'color-clash': playColorClash,
    estimate: playEstimate,
    'count-up': playCountUp,
  }[data.id];
  (fn || playBullseye)(data);
}

function playFlashMemory(data) {
  const { size, cells, revealMs, playMs } = data.payload;
  gameFrame(data.name, `ROUND ${data.round} // GAME ${data.roundGameNumber}/${data.roundGameTotal}`,
    `<div class="memory-grid" style="grid-template-columns:repeat(${size},1fr)">${Array.from({length:size*size},(_,i)=>`<button class="memory-cell ${cells.includes(i)?'active':''}" data-i="${i}"></button>`).join('')}</div>`);
  const buttons = [...document.querySelectorAll('.memory-cell')];
  let chosen = new Set();
  buttons.forEach((b) => b.disabled = true);
  later(() => {
    buttons.forEach((b) => { b.classList.remove('active'); b.disabled = false; b.onclick = () => {
      if (state.submitted) return;
      const i = Number(b.dataset.i);
      if (chosen.has(i)) { chosen.delete(i); b.classList.remove('selected'); }
      else { chosen.add(i); b.classList.add('selected'); }
      if (chosen.size === cells.length) {
        const score = [...chosen].filter((x) => cells.includes(x)).length;
        submitGame(score, `${score}/${cells.length} correct`);
      }
    };});
    later(() => {
      if (!state.submitted) {
        const score = [...chosen].filter((x) => cells.includes(x)).length;
        submitGame(score, `${score}/${cells.length} correct`);
      }
    }, playMs);
  }, revealMs);
}

function playBullseye(data) {
  const { durationMs } = data.payload;
  gameFrame(data.name, `ROUND ${data.round} // GAME ${data.roundGameNumber}/${data.roundGameTotal}`,
    `<div class="bullseye-board" id="board"></div><div class="badge" style="position:absolute;top:12px;left:12px">SCORE <span id="score">0</span></div>`);
  const board = document.getElementById('board');
  let score = 0;
  let alive = true;
  function spawn() {
    if (!alive) return;
    board.querySelectorAll('.target').forEach((x) => x.remove());
    const t = document.createElement('button');
    t.className = 'target';
    const size = 26 + Math.random() * 50;
    t.style.width = `${size}px`; t.style.height = `${size}px`;
    t.style.left = `${10 + Math.random()*80}%`; t.style.top = `${12 + Math.random()*76}%`;
    const value = Math.round(1000 / size);
    t.onclick = () => { score += value; document.getElementById('score').textContent = score; spawn(); };
    board.appendChild(t);
  }
  spawn();
  later(() => { alive = false; submitGame(score, `${score} target score`); }, durationMs);
}

function playSequence(data) {
  const seq = data.payload.sequence;
  gameFrame(data.name, `ROUND ${data.round} // GAME ${data.roundGameNumber}/${data.roundGameTotal}`,
    `<div class="center"><p class="subtle" id="seqMsg">WATCH THE SEQUENCE</p><div class="sequence-pad">${[0,1,2,3].map(i=>`<button class="seq" data-i="${i}"></button>`).join('')}</div></div>`);
  const pads = [...document.querySelectorAll('.seq')];
  pads.forEach(p => p.disabled = true);
  let idx = 0;
  function flashStep(n) {
    if (n >= seq.length) {
      document.getElementById('seqMsg').textContent = 'REPEAT IT';
      pads.forEach((p) => { p.disabled = false; p.onclick = () => {
        if (state.submitted) return;
        const v = Number(p.dataset.i);
        if (v === seq[idx]) {
          idx++;
          p.classList.add('on'); later(()=>p.classList.remove('on'),120);
          if (idx === seq.length) submitGame(idx, `${idx}/${seq.length} correct`);
        } else submitGame(idx, `${idx}/${seq.length} correct`);
      };});
      later(() => { if (!state.submitted) submitGame(idx, `${idx}/${seq.length} correct`); }, data.payload.playMs);
      return;
    }
    pads[seq[n]].classList.add('on');
    later(() => { pads[seq[n]].classList.remove('on'); later(() => flashStep(n+1), 180); }, data.payload.stepMs);
  }
  later(() => flashStep(0), 700);
}

function playRed(data) {
  const { delayMs, maxMs } = data.payload;
  gameFrame(data.name, `ROUND ${data.round} // GAME ${data.roundGameNumber}/${data.roundGameTotal}`,
    `<div class="center"><button class="red-button" id="redBtn">RED</button><p class="subtle">CLICK ONLY WHEN IT CHANGES.</p></div>`);
  const btn = document.getElementById('redBtn');
  let greenAt = null;
  let falseStart = false;
  btn.onclick = () => {
    if (state.submitted) return;
    if (!greenAt) {
      falseStart = true;
      btn.textContent = 'FALSE START';
      submitGame(9999, 'False start');
    } else {
      const reaction = performance.now() - greenAt;
      submitGame(reaction, `${Math.round(reaction)} ms`);
    }
  };
  later(() => {
    if (falseStart || state.submitted) return;
    greenAt = performance.now();
    btn.classList.add('green');
    btn.textContent = 'GO';
    later(() => { if (!state.submitted) submitGame(maxMs, 'No reaction'); }, maxMs);
  }, delayMs);
}

function playBombPass(data) {
  gameFrame(data.name, `ROUND ${data.round} // GAME ${data.roundGameNumber}/${data.roundGameTotal}`,
    `<div class="bomb-card center">
      <div class="bomb-icon">◉</div>
      <h2 id="bombTitle">INITIALIZING BOMB...</h2>
      <p class="subtle" id="bombHint">The fuse is hidden. If you are holding it, pass it to another active player before it explodes.</p>
      <div class="stack" id="bombPlayers"></div>
      <div style="height:14px"></div>
      <div class="badge" id="bombStatus">WAITING FOR SERVER</div>
    </div>`);
}

const colorCss = {
  RED: '#ff4d4d', BLUE: '#4da6ff', GREEN: '#55d66b', YELLOW: '#ffd84d', PURPLE: '#b777ff', ORANGE: '#ff9b42'
};
function playColorClash(data) {
  const { items, colors, perItemMs } = data.payload;
  let i = 0, score = 0;
  gameFrame(data.name, `ROUND ${data.round} // GAME ${data.roundGameNumber}/${data.roundGameTotal}`,
    `<div class="center"><div class="kicker">CHOOSE THE INK COLOR, NOT THE WORD</div><div id="colorWord" class="color-word">READY</div><div class="color-buttons">${colors.map(c=>`<button class="btn" data-c="${c}">${c}</button>`).join('')}</div><div style="height:14px"></div><div class="badge" id="colorProgress">0/${items.length}</div></div>`);
  const word = document.getElementById('colorWord');
  const buttons = [...document.querySelectorAll('[data-c]')];
  let deadlineTimer = null;
  function next() {
    if (i >= items.length) return submitGame(score, `${score}/${items.length} correct`);
    const item = items[i];
    word.textContent = item.word;
    word.style.color = colorCss[item.ink];
    document.getElementById('colorProgress').textContent = `${i+1}/${items.length}`;
    buttons.forEach(b => b.disabled = false);
    deadlineTimer = later(() => { i++; next(); }, perItemMs);
  }
  buttons.forEach((b) => b.onclick = () => {
    if (state.submitted || i >= items.length) return;
    if (b.dataset.c === items[i].ink) score++;
    clearTimeout(deadlineTimer); state.timers.delete(deadlineTimer);
    i++; next();
  });
  later(next, 700);
}

function playEstimate(data) {
  const target = data.payload.target;
  gameFrame(data.name, `ROUND ${data.round} // GAME ${data.roundGameNumber}/${data.roundGameTotal}`,
    `<div class="estimate-zone"><div class="kicker">STOP THE TIMER AT</div><div class="huge">${target.toFixed(2)}s</div><div id="clock" class="estimate-clock">0.00</div><button class="btn big" id="stop">START</button><p class="subtle">The clock disappears after one second. Estimate the rest.</p></div>`);
  const btn = document.getElementById('stop');
  const clock = document.getElementById('clock');
  let start = null;
  let running = false;
  let raf;
  btn.onclick = () => {
    if (state.submitted) return;
    if (!running) {
      running = true; start = performance.now(); btn.textContent = 'STOP';
      const tick = () => {
        if (!running) return;
        const e = (performance.now() - start) / 1000;
        clock.textContent = e < 1 ? e.toFixed(2) : '??.??';
        raf = requestAnimationFrame(tick);
      };
      tick();
    } else {
      running = false; cancelAnimationFrame(raf);
      const elapsed = (performance.now() - start) / 1000;
      const error = Math.abs(elapsed - target);
      clock.textContent = elapsed.toFixed(2);
      submitGame(error, `${elapsed.toFixed(2)}s (${error.toFixed(2)}s off)`);
    }
  };
}

function playCountUp(data) {
  const { items, targetColor, targetShape, answer, flashMs } = data.payload;
  gameFrame(data.name, `ROUND ${data.round} // GAME ${data.roundGameNumber}/${data.roundGameTotal}`,
    `<div class="center"><div id="countDisplay" style="min-height:170px;display:grid;place-items:center"></div><div id="countPrompt" class="hidden"><h2>HOW MANY ${targetColor} ${targetShape}S?</h2><label>ANSWER<input id="countAnswer" inputmode="numeric" placeholder="0"></label><div style="height:10px"></div><button class="btn" id="countSubmit">SUBMIT</button></div></div>`);
  const display = document.getElementById('countDisplay');
  let i = 0;
  const cssColors = { WHITE:'#f4f4f4', GRAY:'#888', BLACK:'#2c2c2c' };
  function showNext() {
    if (i >= items.length) {
      display.innerHTML = '';
      document.getElementById('countPrompt').classList.remove('hidden');
      const input = document.getElementById('countAnswer');
      document.getElementById('countSubmit').onclick = () => {
        const guess = Number(input.value);
        const correct = Number.isFinite(guess) && guess === answer ? 1 : 0;
        submitGame(correct, `Answer: ${guess || 0}; correct: ${answer}`);
      };
      later(() => { if (!state.submitted) submitGame(0, `No answer; correct: ${answer}`); }, 10000);
      return;
    }
    const x = items[i++];
    display.innerHTML = `<div style="color:${cssColors[x.color]}" class="shape-${x.shape.toLowerCase()}"></div>`;
    later(() => { display.innerHTML = ''; later(showNext, 80); }, flashMs);
  }
  later(showNext, 650);
}

function renderGameResults(data) {
  clearTimers();
  const rows = data.results.map((r) => `
    <div class="result-row ${r.id === socket.id ? 'me' : ''}">
      <div class="rank">${String(r.place).padStart(2,'0')}</div>
      <div><strong>${esc(r.name)}</strong><div class="subtle">${esc(r.detail || r.raw)}</div></div>
      <div class="points">+${r.points}</div>
      <div class="subtle">${data.round === 4 ? `${r.arenaPoints} ARENA` : `${r.roundPoints} ROUND`}</div>
    </div>`).join('');
  app.innerHTML = panel(`
    <div class="kicker">MINIGAME COMPLETE</div>
    <h2>${esc(data.gameName)} RESULTS</h2>
    <div class="results-list">${rows}</div>
    <div class="divider"></div>
    ${isHost() ? `<button class="btn big full" id="continue">CONTINUE</button>` : `<div class="badge">WAITING FOR HOST</div>`}
  `, `ROUND ${data.round}`);
  if (isHost()) document.getElementById('continue').onclick = async () => {
    const res = await emitAck('game:continue');
    if (!res.ok) showToast(res.error);
  };
}

function renderRoundResults(data) {
  clearTimers();
  const rows = data.standings.map((r) => `
    <div class="result-row ${!r.advanced ? 'out' : ''}">
      <div class="rank">${String(r.place).padStart(2,'0')}</div>
      <div>${esc(r.name)}</div>
      <div class="points">${r.roundPoints} PTS</div>
      <div class="badge">${r.advanced ? 'ADVANCE' : 'ELIMINATED'}</div>
    </div>`).join('');
  app.innerHTML = panel(`
    <div class="kicker">ROUND ${data.round} COMPLETE</div>
    <h2>TOP ${data.qualificationTarget} ADVANCE</h2>
    <div class="results-list">${rows}</div>
    <div class="divider"></div>
    ${isHost() ? `<button class="btn big full" id="nextRound">NEXT ROUND</button>` : `<div class="badge">WAITING FOR HOST</div>`}
  `, `ROUND ${data.round} RESULTS`);
  if (isHost()) document.getElementById('nextRound').onclick = async () => {
    const res = await emitAck('round:continue');
    if (!res.ok) showToast(res.error);
  };
}

function renderFinalResults(results) {
  clearTimers();
  const winner = results[0];
  const rows = results.map((r) => `
    <div class="result-row ${r.id === socket.id ? 'me' : ''}">
      <div class="rank">${String(r.place).padStart(2,'0')}</div>
      <div><strong>${esc(r.name)}</strong><div class="subtle">${r.bestGame ? `BEST: ${esc(r.bestGame)}` : 'NO BEST GAME'}</div></div>
      <div class="points">${r.finalist ? `${r.arenaPoints} ARENA` : `${r.totalPoints} PTS`}</div>
      <div class="subtle">${r.minigameWins} WINS</div>
    </div>`).join('');
  app.innerHTML = panel(`
    <div class="center">
      <div class="kicker">MATCH COMPLETE</div>
      <h2>WINNER</h2>
      <div class="huge">${esc(winner?.name || 'PLAYER')}</div>
      <p class="subtle">${winner ? `${winner.arenaPoints} ARENA POINTS` : ''}</p>
    </div>
    <div class="divider"></div>
    <div class="results-list">${rows}</div>
    <div class="divider"></div>
    ${isHost() ? `<button class="btn big full" id="backLobby">BACK TO LOBBY</button>` : `<div class="badge">WAITING FOR HOST TO RETURN TO LOBBY</div>`}
  `, 'FINAL RESULTS');
  if (isHost()) document.getElementById('backLobby').onclick = async () => {
    const res = await emitAck('match:returnToLobby');
    if (!res.ok) showToast(res.error);
  };
}

socket.on('connect', () => {
  state.playerId = socket.id;
  if (!state.lobby) renderHome();
});
socket.on('disconnect', () => showToast('CONNECTION LOST'));

socket.on('lobby:update', (lobby) => {
  state.lobby = lobby;
  if (lobby.phase === 'lobby') renderLobby();
});
socket.on('lobby:kicked', () => { state.lobby = null; showToast('REMOVED FROM LOBBY'); renderHome(); });
socket.on('host:changed', () => showToast('HOST CHANGED'));
socket.on('match:roundIntro', renderRoundIntro);
socket.on('game:preview', renderGameCutscene);
socket.on('game:start', playGame);
socket.on('game:submissionCount', ({ submitted, expected }) => {
  const el = document.getElementById('submissionCount');
  if (el) el.textContent = `${submitted}/${expected} SUBMITTED`;
});
socket.on('bomb:update', ({ holderId, alive, eliminated }) => {
  if (state.currentGame?.id !== 'bomb-pass') return;
  const title = document.getElementById('bombTitle');
  const list = document.getElementById('bombPlayers');
  const status = document.getElementById('bombStatus');
  if (!title || !list || !status) return;

  const holder = state.lobby?.players.find((p) => p.id === holderId);
  const iAmAlive = alive.includes(socket.id);
  const iHaveBomb = holderId === socket.id;
  title.textContent = holder ? `${holder.name} HAS THE BOMB` : 'BOMB ACTIVE';
  status.textContent = iHaveBomb ? 'PASS IT' : iAmAlive ? 'SURVIVE' : 'ELIMINATED FROM MINIGAME';

  list.innerHTML = alive.map((id) => {
    const p = state.lobby?.players.find((x) => x.id === id);
    const canTarget = iHaveBomb && id !== socket.id;
    return `<button class="btn ${id === holderId ? '' : 'ghost'} bomb-target" data-id="${id}" ${canTarget ? '' : 'disabled'}>${esc(p?.name || 'PLAYER')}${id === holderId ? ' // BOMB' : ''}</button>`;
  }).join('') || '<div class="subtle">NO ACTIVE PLAYERS</div>';

  document.querySelectorAll('.bomb-target').forEach((b) => b.onclick = async () => {
    const res = await emitAck('bomb:pass', { toId: b.dataset.id });
    if (!res.ok && res.error !== 'Pass cooldown.') showToast(res.error);
  });
});

socket.on('bomb:explode', ({ victimId }) => {
  if (state.currentGame?.id !== 'bomb-pass') return;
  const victim = state.lobby?.players.find((p) => p.id === victimId);
  const title = document.getElementById('bombTitle');
  if (title) title.textContent = `${victim?.name || 'PLAYER'} // BOOM`;
});

socket.on('game:results', renderGameResults);
socket.on('round:results', renderRoundResults);
socket.on('match:finalResults', renderFinalResults);
socket.on('match:returnedToLobby', () => showToast('MATCH RESET'));

renderHome();
