const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 20000,
  pingInterval: 10000,
});

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 20;
const GAME_PREVIEW_MS = 4200;
const MIN_PLAYERS = 2;
const LOBBY_CODE_LENGTH = 5;

const GAME_IDS = [
  'flash-memory',
  'bullseye',
  'sequence',
  'red',
  'bomb-pass',
  'color-clash',
  'estimate',
  'count-up',
];

const GAME_META = {
  'flash-memory': { name: 'FLASH MEMORY', higherIsBetter: true },
  bullseye: { name: 'BULLSEYE', higherIsBetter: true },
  sequence: { name: 'SEQUENCE', higherIsBetter: true },
  red: { name: 'RED!', higherIsBetter: false },
  'bomb-pass': { name: 'BOMB PASS', higherIsBetter: true },
  'color-clash': { name: 'COLOR CLASH', higherIsBetter: true },
  estimate: { name: 'ESTIMATE', higherIsBetter: false },
  'count-up': { name: 'COUNT UP', higherIsBetter: true },
};

const lobbies = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, lobbies: lobbies.size }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

function cleanName(name) {
  return String(name || '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < LOBBY_CODE_LENGTH; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  } while (lobbies.has(code));
  return code;
}

function shuffle(input) {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function publicLobby(lobby) {
  return {
    code: lobby.code,
    hostId: lobby.hostId,
    locked: lobby.locked,
    phase: lobby.phase,
    round: lobby.round,
    gameIndex: lobby.gameIndex,
    players: [...lobby.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      eliminated: p.eliminated,
      eliminatedRound: p.eliminatedRound,
      totalPoints: p.totalPoints,
      roundPoints: p.roundPoints,
      arenaPoints: p.arenaPoints,
      minigameWins: p.minigameWins,
      bestGame: p.bestGame,
      bestGamePoints: p.bestGamePoints,
    })),
    activePlayerIds: [...lobby.activePlayerIds],
    currentGame: lobby.currentGame,
    currentGameNumber: lobby.currentGameNumber,
    roundGameNumber: lobby.roundGameNumber,
    roundGameTotal: lobby.roundGameTotal,
    qualificationTarget: lobby.qualificationTarget,
  };
}

function emitLobby(lobby) {
  io.to(lobby.code).emit('lobby:update', publicLobby(lobby));
}

function getPlayerLobby(socket) {
  const code = socket.data.lobbyCode;
  if (!code) return null;
  return lobbies.get(code) || null;
}

function createLobby(hostSocket, name) {
  const code = makeCode();
  const host = {
    id: hostSocket.id,
    name,
    connected: true,
    eliminated: false,
    eliminatedRound: null,
    totalPoints: 0,
    roundPoints: 0,
    arenaPoints: 0,
    minigameWins: 0,
    bestGame: null,
    bestGamePoints: -Infinity,
  };

  const lobby = {
    code,
    hostId: hostSocket.id,
    locked: false,
    phase: 'lobby',
    players: new Map([[hostSocket.id, host]]),
    activePlayerIds: new Set([hostSocket.id]),
    initialPlayerCount: 1,
    round: 0,
    gameIndex: 0,
    currentGame: null,
    currentGameNumber: 0,
    roundGameNumber: 0,
    roundGameTotal: 0,
    qualificationTarget: null,
    schedule: [],
    submissions: new Map(),
    roundResults: [],
    finalResults: [],
    roundAdvanceTimer: null,
    bombState: null,
  };

  lobbies.set(code, lobby);
  hostSocket.join(code);
  hostSocket.data.lobbyCode = code;
  return lobby;
}

function addPlayer(socket, lobby, name) {
  lobby.players.set(socket.id, {
    id: socket.id,
    name,
    connected: true,
    eliminated: false,
    eliminatedRound: null,
    totalPoints: 0,
    roundPoints: 0,
    arenaPoints: 0,
    minigameWins: 0,
    bestGame: null,
    bestGamePoints: -Infinity,
  });
  lobby.activePlayerIds.add(socket.id);
  socket.join(lobby.code);
  socket.data.lobbyCode = lobby.code;
}

function scheduleForMatch() {
  const shuffled = shuffle(GAME_IDS);
  return [
    shuffled.slice(0, 2),
    shuffled.slice(2, 4),
    shuffled.slice(4, 6),
    shuffled.slice(6, 8),
  ];
}

function resetMatchState(lobby) {
  lobby.phase = 'lobby';
  lobby.round = 0;
  lobby.gameIndex = 0;
  lobby.currentGame = null;
  lobby.currentGameNumber = 0;
  lobby.roundGameNumber = 0;
  lobby.roundGameTotal = 0;
  lobby.qualificationTarget = null;
  lobby.schedule = [];
  lobby.submissions = new Map();
  lobby.roundResults = [];
  lobby.finalResults = [];
  lobby.bombState = null;
  lobby.activePlayerIds = new Set();

  for (const p of lobby.players.values()) {
    if (!p.connected) continue;
    p.eliminated = false;
    p.eliminatedRound = null;
    p.totalPoints = 0;
    p.roundPoints = 0;
    p.arenaPoints = 0;
    p.minigameWins = 0;
    p.bestGame = null;
    p.bestGamePoints = -Infinity;
    lobby.activePlayerIds.add(p.id);
  }
}

function startMatch(lobby) {
  const connected = [...lobby.players.values()].filter((p) => p.connected);
  if (connected.length < MIN_PLAYERS) return { ok: false, error: 'At least 2 players are required.' };

  resetMatchState(lobby);
  lobby.phase = 'round-intro';
  lobby.initialPlayerCount = connected.length;
  lobby.schedule = scheduleForMatch();
  lobby.round = 1;
  lobby.gameIndex = 0;
  lobby.roundGameTotal = lobby.schedule[0].length;
  lobby.qualificationTarget = qualificationTarget(lobby.initialPlayerCount, 1);
  emitLobby(lobby);
  io.to(lobby.code).emit('match:roundIntro', roundIntroPayload(lobby));
  return { ok: true };
}

function qualificationTarget(initialCount, round) {
  if (initialCount <= 4) return initialCount;
  if (round === 1) return Math.max(4, Math.ceil(initialCount * 0.75));
  if (round === 2) return Math.max(4, Math.ceil(initialCount * 0.5));
  if (round === 3) return 4;
  return Math.min(4, initialCount);
}

function roundIntroPayload(lobby) {
  return {
    round: lobby.round,
    isFinal: lobby.round === 4,
    activePlayers: lobby.activePlayerIds.size,
    qualificationTarget: lobby.round === 4 ? null : lobby.qualificationTarget,
    games: lobby.schedule[lobby.round - 1].map((id) => GAME_META[id].name),
  };
}

function startCurrentGame(lobby) {
  const games = lobby.schedule[lobby.round - 1];
  if (!games || lobby.gameIndex >= games.length) return endRound(lobby);

  lobby.phase = 'game-preview';
  lobby.currentGame = games[lobby.gameIndex];
  lobby.roundGameNumber = lobby.gameIndex + 1;
  lobby.roundGameTotal = games.length;
  lobby.currentGameNumber += 1;
  lobby.submissions = new Map();

  const payload = makeGamePayload(lobby.currentGame, lobby.activePlayerIds.size);
  const gamePacket = {
    id: lobby.currentGame,
    name: GAME_META[lobby.currentGame].name,
    round: lobby.round,
    roundGameNumber: lobby.roundGameNumber,
    roundGameTotal: lobby.roundGameTotal,
    payload,
  };

  io.to(lobby.code).emit('game:preview', gamePacket);
  emitLobby(lobby);

  setTimeout(() => {
    if (!lobbies.has(lobby.code)) return;
    if (lobby.phase !== 'game-preview' || lobby.currentGame !== gamePacket.id) return;
    lobby.phase = 'game';
    io.to(lobby.code).emit('game:start', gamePacket);
    emitLobby(lobby);
    if (lobby.currentGame === 'bomb-pass') startBombPass(lobby);
  }, GAME_PREVIEW_MS);
}

function makeGamePayload(gameId, playerCount) {
  switch (gameId) {
    case 'flash-memory': {
      const size = 4;
      const count = 6;
      const cells = shuffle(Array.from({ length: size * size }, (_, i) => i)).slice(0, count);
      return { size, cells, revealMs: 2200, playMs: 10000 };
    }
    case 'sequence': {
      const length = 6;
      const sequence = Array.from({ length }, () => Math.floor(Math.random() * 4));
      return { sequence, stepMs: 550, playMs: 12000 };
    }
    case 'red':
      return { delayMs: 1500 + Math.floor(Math.random() * 3500), maxMs: 3000 };
    case 'bomb-pass':
      return { rounds: Math.max(2, Math.min(5, playerCount - 1)) };
    case 'color-clash': {
      const colors = ['RED', 'BLUE', 'GREEN', 'YELLOW', 'PURPLE', 'ORANGE'];
      const items = Array.from({ length: 12 }, () => {
        const word = colors[Math.floor(Math.random() * colors.length)];
        let ink = colors[Math.floor(Math.random() * colors.length)];
        if (Math.random() < 0.8 && ink === word) {
          ink = colors[(colors.indexOf(ink) + 1) % colors.length];
        }
        return { word, ink };
      });
      return { colors, items, perItemMs: 2200 };
    }
    case 'estimate': {
      const target = 4 + Math.random() * 5;
      return { type: 'timer', target: Number(target.toFixed(2)), max: 12 };
    }
    case 'count-up': {
      const colors = ['WHITE', 'GRAY', 'BLACK'];
      const shapes = ['SQUARE', 'CIRCLE', 'TRIANGLE'];
      const targetColor = colors[Math.floor(Math.random() * colors.length)];
      const targetShape = shapes[Math.floor(Math.random() * shapes.length)];
      const items = Array.from({ length: 26 }, () => ({
        color: colors[Math.floor(Math.random() * colors.length)],
        shape: shapes[Math.floor(Math.random() * shapes.length)],
      }));
      const answer = items.filter((x) => x.color === targetColor && x.shape === targetShape).length;
      return { targetColor, targetShape, items, answer, flashMs: 210 };
    }
    case 'bullseye':
    default:
      return { durationMs: 12000, targetCount: 30 };
  }
}


function startBombPass(lobby) {
  const alive = [...lobby.activePlayerIds].filter((id) => lobby.players.get(id)?.connected);
  lobby.bombState = {
    alive: new Set(alive),
    eliminatedOrder: [],
    holderId: null,
    fuseTimer: null,
    canPassAt: 0,
  };

  if (alive.length <= 1) {
    if (alive[0]) lobby.submissions.set(alive[0], { raw: 1, detail: 'Last player standing' });
    return rankGame(lobby);
  }

  startBombFuse(lobby);
}

function startBombFuse(lobby) {
  const state = lobby.bombState;
  if (!state || lobby.currentGame !== 'bomb-pass' || lobby.phase !== 'game') return;

  const alive = [...state.alive];
  if (alive.length <= 1) {
    if (alive[0]) {
      lobby.submissions.set(alive[0], { raw: state.eliminatedOrder.length + 1, detail: 'Last player standing' });
    }
    return rankGame(lobby);
  }

  if (!state.holderId || !state.alive.has(state.holderId)) {
    state.holderId = alive[Math.floor(Math.random() * alive.length)];
  }

  const fuseMs = 4500 + Math.floor(Math.random() * 4500);
  state.canPassAt = Date.now() + 650;
  if (state.fuseTimer) clearTimeout(state.fuseTimer);

  io.to(lobby.code).emit('bomb:update', {
    holderId: state.holderId,
    alive,
    eliminated: [...state.eliminatedOrder],
  });

  state.fuseTimer = setTimeout(() => explodeBomb(lobby), fuseMs);
}

function explodeBomb(lobby) {
  const state = lobby.bombState;
  if (!state || lobby.currentGame !== 'bomb-pass' || lobby.phase !== 'game') return;
  const victimId = state.holderId;
  if (!victimId || !state.alive.has(victimId)) return startBombFuse(lobby);

  state.alive.delete(victimId);
  state.eliminatedOrder.push(victimId);
  const placementRaw = state.eliminatedOrder.length;
  lobby.submissions.set(victimId, {
    raw: placementRaw,
    detail: `Bombed out #${placementRaw}`,
  });

  io.to(lobby.code).emit('bomb:explode', {
    victimId,
    alive: [...state.alive],
  });

  const survivors = [...state.alive];
  if (survivors.length === 1) {
    const winnerId = survivors[0];
    lobby.submissions.set(winnerId, {
      raw: state.eliminatedOrder.length + 1,
      detail: 'Last player standing',
    });
    state.holderId = winnerId;
    io.to(lobby.code).emit('bomb:update', {
      holderId: winnerId,
      alive: survivors,
      eliminated: [...state.eliminatedOrder],
    });
    return setTimeout(() => {
      if (lobby.phase === 'game' && lobby.currentGame === 'bomb-pass') rankGame(lobby);
    }, 900);
  }

  state.holderId = survivors[Math.floor(Math.random() * survivors.length)];
  setTimeout(() => startBombFuse(lobby), 900);
}

function passBomb(lobby, fromId, toId) {
  const state = lobby.bombState;
  if (!state || lobby.currentGame !== 'bomb-pass' || lobby.phase !== 'game') {
    return { ok: false, error: 'Bomb Pass is not active.' };
  }
  if (state.holderId !== fromId) return { ok: false, error: 'You do not have the bomb.' };
  if (Date.now() < state.canPassAt) return { ok: false, error: 'Pass cooldown.' };
  if (!state.alive.has(toId) || toId === fromId) return { ok: false, error: 'Choose an active player.' };

  state.holderId = toId;
  state.canPassAt = Date.now() + 650;
  io.to(lobby.code).emit('bomb:update', {
    holderId: state.holderId,
    alive: [...state.alive],
    eliminated: [...state.eliminatedOrder],
  });
  return { ok: true };
}

function rankGame(lobby) {
  if (lobby.bombState?.fuseTimer) clearTimeout(lobby.bombState.fuseTimer);
  const gameId = lobby.currentGame;
  const meta = GAME_META[gameId];
  const activeIds = [...lobby.activePlayerIds].filter((id) => {
    const p = lobby.players.get(id);
    return p && p.connected && !p.eliminated;
  });

  const entries = activeIds.map((id) => {
    const submission = lobby.submissions.get(id);
    return {
      id,
      raw: submission ? Number(submission.raw) : worstRaw(gameId),
      detail: submission?.detail || null,
    };
  });

  entries.sort((a, b) => meta.higherIsBetter ? b.raw - a.raw : a.raw - b.raw);

  const base = [10, 8, 6, 5, 4, 3, 2, 1];
  const results = entries.map((entry, index) => {
    const points = index < base.length ? base[index] : 0;
    const p = lobby.players.get(entry.id);
    if (lobby.round === 4) p.arenaPoints += points;
    else {
      p.roundPoints += points;
      p.totalPoints += points;
    }
    if (index === 0) p.minigameWins += 1;
    if (points > p.bestGamePoints) {
      p.bestGamePoints = points;
      p.bestGame = meta.name;
    }
    return {
      id: entry.id,
      name: p.name,
      raw: entry.raw,
      detail: entry.detail,
      points,
      totalPoints: p.totalPoints,
      roundPoints: p.roundPoints,
      arenaPoints: p.arenaPoints,
      place: index + 1,
    };
  });

  lobby.phase = 'game-results';
  lobby.roundResults = results;
  io.to(lobby.code).emit('game:results', {
    gameId,
    gameName: meta.name,
    round: lobby.round,
    results,
  });
  emitLobby(lobby);
}

function worstRaw(gameId) {
  return GAME_META[gameId].higherIsBetter ? -999999 : 999999;
}

function endRound(lobby) {
  if (lobby.round === 4) return finishMatch(lobby);

  const active = [...lobby.activePlayerIds]
    .map((id) => lobby.players.get(id))
    .filter(Boolean)
    .sort((a, b) => b.roundPoints - a.roundPoints || b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));

  const target = Math.min(active.length, lobby.qualificationTarget);
  const advancing = new Set(active.slice(0, target).map((p) => p.id));
  const eliminated = active.slice(target);

  eliminated.forEach((p) => {
    p.eliminated = true;
    p.eliminatedRound = lobby.round;
    lobby.activePlayerIds.delete(p.id);
  });

  lobby.phase = 'round-results';
  io.to(lobby.code).emit('round:results', {
    round: lobby.round,
    qualificationTarget: target,
    standings: active.map((p, i) => ({
      place: i + 1,
      id: p.id,
      name: p.name,
      roundPoints: p.roundPoints,
      totalPoints: p.totalPoints,
      advanced: advancing.has(p.id),
    })),
  });
  emitLobby(lobby);
}

function advanceRound(lobby) {
  if (lobby.phase !== 'round-results') return;
  for (const id of lobby.activePlayerIds) {
    const p = lobby.players.get(id);
    if (p) p.roundPoints = 0;
  }

  lobby.round += 1;
  lobby.gameIndex = 0;
  lobby.currentGame = null;
  lobby.phase = 'round-intro';
  lobby.roundGameTotal = lobby.schedule[lobby.round - 1].length;
  lobby.qualificationTarget = lobby.round === 4 ? null : qualificationTarget(lobby.initialPlayerCount, lobby.round);

  if (lobby.round === 4) {
    for (const id of lobby.activePlayerIds) {
      const p = lobby.players.get(id);
      if (p) p.arenaPoints = 0;
    }
  }

  io.to(lobby.code).emit('match:roundIntro', roundIntroPayload(lobby));
  emitLobby(lobby);
}

function finishMatch(lobby) {
  const finalists = [...lobby.activePlayerIds]
    .map((id) => lobby.players.get(id))
    .filter(Boolean)
    .sort((a, b) => b.arenaPoints - a.arenaPoints || b.totalPoints - a.totalPoints || b.minigameWins - a.minigameWins);

  const eliminated = [...lobby.players.values()]
    .filter((p) => p.eliminated)
    .sort((a, b) => (b.eliminatedRound || 0) - (a.eliminatedRound || 0) || b.totalPoints - a.totalPoints);

  const ordered = [...finalists, ...eliminated];
  lobby.finalResults = ordered.map((p, index) => ({
    place: index + 1,
    id: p.id,
    name: p.name,
    totalPoints: p.totalPoints,
    arenaPoints: p.arenaPoints,
    minigameWins: p.minigameWins,
    bestGame: p.bestGame,
    roundReached: p.eliminatedRound ? p.eliminatedRound : 4,
    finalist: finalists.some((x) => x.id === p.id),
  }));

  lobby.phase = 'final-results';
  io.to(lobby.code).emit('match:finalResults', lobby.finalResults);
  emitLobby(lobby);
}

function leaveLobby(socket) {
  const lobby = getPlayerLobby(socket);
  if (!lobby) return;
  const player = lobby.players.get(socket.id);
  if (player) player.connected = false;
  lobby.activePlayerIds.delete(socket.id);
  socket.leave(lobby.code);
  socket.data.lobbyCode = null;

  const connectedPlayers = [...lobby.players.values()].filter((p) => p.connected);
  if (connectedPlayers.length === 0) {
    lobbies.delete(lobby.code);
    return;
  }

  if (lobby.hostId === socket.id) {
    lobby.hostId = connectedPlayers[0].id;
    io.to(lobby.code).emit('host:changed', { hostId: lobby.hostId });
  }
  emitLobby(lobby);
}

io.on('connection', (socket) => {
  socket.on('lobby:create', ({ name }, ack = () => {}) => {
    const safeName = cleanName(name);
    if (!safeName) return ack({ ok: false, error: 'Enter a player name.' });
    if (getPlayerLobby(socket)) leaveLobby(socket);
    const lobby = createLobby(socket, safeName);
    ack({ ok: true, code: lobby.code, playerId: socket.id });
    emitLobby(lobby);
  });

  socket.on('lobby:join', ({ code, name }, ack = () => {}) => {
    const safeName = cleanName(name);
    const safeCode = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, LOBBY_CODE_LENGTH);
    const lobby = lobbies.get(safeCode);

    if (!safeName) return ack({ ok: false, error: 'Enter a player name.' });
    if (!lobby) return ack({ ok: false, error: 'Lobby not found.' });
    if (lobby.locked) return ack({ ok: false, error: 'Lobby is locked.' });
    if (lobby.phase !== 'lobby') return ack({ ok: false, error: 'That lobby is currently in a match.' });
    if ([...lobby.players.values()].filter((p) => p.connected).length >= MAX_PLAYERS) {
      return ack({ ok: false, error: 'Lobby is full.' });
    }
    if (getPlayerLobby(socket)) leaveLobby(socket);
    addPlayer(socket, lobby, safeName);
    ack({ ok: true, code: lobby.code, playerId: socket.id });
    emitLobby(lobby);
  });

  socket.on('lobby:leave', () => leaveLobby(socket));

  socket.on('lobby:toggleLock', (_payload, ack = () => {}) => {
    const lobby = getPlayerLobby(socket);
    if (!lobby || lobby.hostId !== socket.id) return ack({ ok: false, error: 'Host only.' });
    lobby.locked = !lobby.locked;
    emitLobby(lobby);
    ack({ ok: true, locked: lobby.locked });
  });

  socket.on('lobby:kick', ({ playerId }, ack = () => {}) => {
    const lobby = getPlayerLobby(socket);
    if (!lobby || lobby.hostId !== socket.id) return ack({ ok: false, error: 'Host only.' });
    if (playerId === lobby.hostId) return ack({ ok: false, error: 'The host cannot kick themselves.' });
    const target = io.sockets.sockets.get(playerId);
    if (!target || target.data.lobbyCode !== lobby.code) return ack({ ok: false, error: 'Player not found.' });
    target.emit('lobby:kicked');
    leaveLobby(target);
    ack({ ok: true });
  });

  socket.on('match:start', (_payload, ack = () => {}) => {
    const lobby = getPlayerLobby(socket);
    if (!lobby || lobby.hostId !== socket.id) return ack({ ok: false, error: 'Host only.' });
    if (lobby.phase !== 'lobby') return ack({ ok: false, error: 'Match already started.' });
    const result = startMatch(lobby);
    ack(result);
  });

  socket.on('match:startRoundGames', (_payload, ack = () => {}) => {
    const lobby = getPlayerLobby(socket);
    if (!lobby || lobby.hostId !== socket.id) return ack({ ok: false, error: 'Host only.' });
    if (lobby.phase !== 'round-intro') return ack({ ok: false, error: 'Not ready.' });
    startCurrentGame(lobby);
    ack({ ok: true });
  });

  socket.on('game:submit', ({ raw, detail }, ack = () => {}) => {
    const lobby = getPlayerLobby(socket);
    if (!lobby || lobby.phase !== 'game') return ack({ ok: false, error: 'No active game.' });
    if (lobby.currentGame === 'bomb-pass') return ack({ ok: false, error: 'Bomb Pass is scored by the server.' });
    if (!lobby.activePlayerIds.has(socket.id)) return ack({ ok: false, error: 'You are not active in this round.' });
    if (lobby.submissions.has(socket.id)) return ack({ ok: false, error: 'Already submitted.' });

    const numericRaw = Number(raw);
    if (!Number.isFinite(numericRaw)) return ack({ ok: false, error: 'Invalid result.' });
    lobby.submissions.set(socket.id, { raw: numericRaw, detail: detail || null });
    ack({ ok: true });

    const expected = [...lobby.activePlayerIds].filter((id) => lobby.players.get(id)?.connected).length;
    io.to(lobby.code).emit('game:submissionCount', { submitted: lobby.submissions.size, expected });
    if (lobby.submissions.size >= expected) rankGame(lobby);
  });


  socket.on('bomb:pass', ({ toId }, ack = () => {}) => {
    const lobby = getPlayerLobby(socket);
    if (!lobby) return ack({ ok: false, error: 'No lobby.' });
    ack(passBomb(lobby, socket.id, String(toId || '')));
  });

  socket.on('game:forceResults', (_payload, ack = () => {}) => {
    const lobby = getPlayerLobby(socket);
    if (!lobby || lobby.hostId !== socket.id) return ack({ ok: false, error: 'Host only.' });
    if (lobby.phase !== 'game') return ack({ ok: false, error: 'No game in progress.' });
    rankGame(lobby);
    ack({ ok: true });
  });

  socket.on('game:continue', (_payload, ack = () => {}) => {
    const lobby = getPlayerLobby(socket);
    if (!lobby || lobby.hostId !== socket.id) return ack({ ok: false, error: 'Host only.' });
    if (lobby.phase !== 'game-results') return ack({ ok: false, error: 'Not ready.' });
    lobby.gameIndex += 1;
    startCurrentGame(lobby);
    ack({ ok: true });
  });

  socket.on('round:continue', (_payload, ack = () => {}) => {
    const lobby = getPlayerLobby(socket);
    if (!lobby || lobby.hostId !== socket.id) return ack({ ok: false, error: 'Host only.' });
    advanceRound(lobby);
    ack({ ok: true });
  });

  socket.on('match:returnToLobby', (_payload, ack = () => {}) => {
    const lobby = getPlayerLobby(socket);
    if (!lobby || lobby.hostId !== socket.id) return ack({ ok: false, error: 'Host only.' });
    if (lobby.phase !== 'final-results') return ack({ ok: false, error: 'Match is not finished.' });
    resetMatchState(lobby);
    emitLobby(lobby);
    io.to(lobby.code).emit('match:returnedToLobby');
    ack({ ok: true });
  });

  socket.on('disconnect', () => leaveLobby(socket));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MINIGAME ARENA listening on port ${PORT}`);
});
