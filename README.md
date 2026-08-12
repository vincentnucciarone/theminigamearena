# MINIGAME ARENA

Realtime hosted multiplayer minigame tournament for 2-20 players.

## Included

- Create / join lobby with a 5-character code
- Host-only start, kick, lock, continue, and return-to-lobby controls
- 20-player lobby cap
- Four-round structure
- Dynamic qualification based on starting player count
- No eliminations before the final when the match starts with 4 or fewer players
- Eight minigames:
  - Flash Memory
  - Bullseye
  - Sequence
  - RED!
  - Bomb Pass
  - Color Clash
  - Estimate
  - Count Up
- Final Minigame Arena with final-only Arena Points
- Match results and return to the same waiting room
- Monochrome, blocky, monospace UI
- No personal-name placeholder data. The placeholder is simply `Player Name`.

## Run locally

```bash
npm install
npm start
```

Then open:

```text
http://localhost:3000
```

Open multiple browser windows or devices to test multiplayer.

## Deploy to Render

1. Put this folder in a GitHub repository.
2. In Render, create a **Web Service** from that repository.
3. Runtime: **Node**.
4. Build Command:

```text
npm install
```

5. Start Command:

```text
npm start
```

6. Deploy.

Render automatically provides the `PORT` environment variable. The server already listens on it.

## Match format

Every match uses all eight minigames exactly once. They are shuffled into two minigames per round.

- Round 1: top `ceil(starting players × 0.75)` advance, minimum 4.
- Round 2: top `ceil(starting players × 0.50)` advance, minimum 4.
- Round 3: top 4 advance.
- If the match starts with 4 or fewer players, nobody is eliminated in Rounds 1-3.
- Round 4 is the Minigame Arena. Arena Points reset to 0 and decide the winner.

Examples:

- 20 players -> 15 -> 10 -> 4 -> Final
- 12 players -> 9 -> 6 -> 4 -> Final
- 6 players -> 5 -> 4 -> 4 -> Final
- 4 players -> 4 -> 4 -> 4 -> Final

## Notes

Lobby state is stored in server memory. This is intentional for V1 because lobbies are temporary. If the Render process restarts, active lobbies are cleared.
