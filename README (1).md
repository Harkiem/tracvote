# TracVote — P2P Verifiable Polling on Intercom

A decentralized, agent-first voting and polling system built on the **Intercom** stack (Trac Network).

Create polls, cast votes, and compute verifiable tallies — all peer-to-peer via Intercom sidechannels. No central server. No trusted tallier. The tally is always recomputable from the signed envelope log.

**Trac Address (for TNK payout):** ``trac1nayrautlgklgykv34xxfaq3yvdt29wx3zc8p5hx0zmp3hx0jtu2qwep27d

---

## What TracVote Does

- **Poll creators** broadcast signed poll announcements to the `0000tracvote` rendezvous channel.
- **Voters** (human or agent) discover polls, join invite-only `vote:<poll_id>` channels, and submit signed vote envelopes.
- **Talliers** — anyone who has the vote envelopes — can deterministically verify and reproduce the result. No trusted third party needed.
- **Agents** can fully automate discovery → voting → tally publication.

### Supported Poll Types

| Type | Description |
|---|---|
| `single_choice` | Pick exactly one option |
| `multi_choice` | Pick one or more options |
| `approval` | Yes/No per option |
| `ranked_choice` | Order all options (Borda count) |

---

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/tracvote
cd tracvote
npm install -g pear
npm install
```

### Run as voter
```bash
pear run . voter1
```

### Run as poll creator
```bash
pear run . creator1
```

### Headless agent
```bash
node scripts/vote-agent.mjs --store agent1 --role voter --auto-vote 1
```

---

## Protocol Flow

```
Rendezvous channel: 0000tracvote
    |
    | vote.poll_announce  (creator → all peers)
    | vote.poll_rebroadcast  (periodic — no channel history)
    |
    v
Per-poll invite-only channel: vote:<poll_id>
    |
    | vote.cast           (voter → channel)
    | vote.poll_close     (creator → channel, when deadline reached)
    | vote.tally_publish  (anyone → channel, computed from envelope log)
```

---

## Architecture

```
Humans / Agents
      |
      | tool calls / natural language (optional promptd)
      v
TracVote runtime peer
(identity + local poll store)
      |
      +---> Intercom sidechannels (Hyperswarm/HyperDHT)
      |         - Rendezvous:  0000tracvote
      |         - Per-poll:    vote:<poll_id>
      |
      +---> Local SQLite (onchain/polls/<store>.sqlite)
```

---

## CLI Usage

```bash
# Create a poll
node scripts/votectl.mjs create \
  --title "Should we upgrade the protocol?" \
  --options "Yes,No,Abstain" \
  --type single_choice \
  --ends-days 7

# List active polls
node scripts/votectl.mjs list

# Vote
node scripts/votectl.mjs vote --poll-id <uuid> --choices 0

# Show tally
node scripts/votectl.mjs tally --poll-id <uuid>

# Close poll (creator only)
node scripts/votectl.mjs close --poll-id <uuid>
```

---

## Verifiability

The tally is computed from raw signed vote envelopes. Anyone who has the envelopes can reproduce the exact same result:

```js
import { computeTally } from './contract/protocol.js'
const { tally, totalVoters, winnerIds } = computeTally(poll, votes)
```

Deduplification rule: if a voter submits multiple votes on the same poll, **the last envelope wins**. This allows vote changes before a poll closes.

---

## Files

| File | Purpose |
|---|---|
| `contract/protocol.js` | Message builders, validators, tally engine |
| `src/store.js` | SQLite persistence for polls, votes, tallies |
| `scripts/vote-agent.mjs` | Headless voter/creator agent |
| `scripts/votectl.mjs` | CLI for creating polls and voting |
| `ui/index.html` | Browser-based demo UI |
| `test/protocol.test.mjs` | Full unit test suite |
| `SKILL.md` | Agent install + operations guide |

---

## Tests

```bash
npm test
# 21 tests, 0 failures
```

---

## License

MIT — Fork of [Trac-Systems/intercom](https://github.com/Trac-Systems/intercom)
