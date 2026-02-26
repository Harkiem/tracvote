# TracVote SKILL.md — Agent Install & Operations Guide

Canonical installer and runbook for **TracVote**: a P2P verifiable polling system on Intercom.

Read this fully before issuing any commands.

---

## What This App Does

TracVote runs on the Intercom stack (Trac Network):

- **Poll creators** broadcast `vote.poll_announce` messages into `0000tracvote` (the shared rendezvous sidechannel).
- **Voters** join invite-only `vote:<poll_id>` channels and submit signed `vote.cast` envelopes.
- **Talliers** — any peer with the vote envelopes — can deterministically reproduce the tally. No trusted third party required.
- **Agents** can automate the full lifecycle: discover → vote → tally → publish.

---

## Requirements

| Requirement | Version |
|---|---|
| Node.js | 20+ |
| Pear runtime | latest |
| OS | macOS / Linux / Windows |

---

## Install

```bash
git clone https://github.com/YOUR_USERNAME/tracvote
cd tracvote
npm install -g pear
npm install
```

---

## Run Paths

Choose exactly one path. Do not mix.

| Goal | Path | Command |
|---|---|---|
| Local testing | Test | `node scripts/vote-agent.mjs --store test1` |
| Vote on polls | Voter | `pear run . voter1` |
| Create polls | Creator | `pear run . creator1` |
| Headless agent | Agent | `node scripts/vote-agent.mjs --store agent1 --auto-vote 1` |

---

## Headless Agent Flags

```bash
node scripts/vote-agent.mjs [flags]
```

| Flag | Meaning | Default |
|---|---|---|
| `--store <n>` | Peer store name | `agent1` |
| `--sc-port <n>` | SC-Bridge WebSocket port | `49500` |
| `--role <voter\|creator>` | Agent role | `voter` |
| `--auto-vote 0/1` | Auto-vote on discovered polls | `0` |
| `--debug 0/1` | Verbose logs | `0` |

---

## votectl Command Reference

```bash
# Create a poll
node scripts/votectl.mjs create \
  --title "Should we..." \
  --options "Yes,No,Abstain" \
  --type single_choice \
  --ends-days 7 \
  --quorum 0

# List active polls
node scripts/votectl.mjs list

# Cast a vote (choices = comma-separated option ids)
node scripts/votectl.mjs vote \
  --poll-id <uuid> \
  --choices 0 \
  --anonymous 0

# Get current tally
node scripts/votectl.mjs tally --poll-id <uuid>

# Close a poll (creator only)
node scripts/votectl.mjs close --poll-id <uuid> --reason "Deadline reached"
```

---

## Poll Types

| Type | `--type` value | Behavior |
|---|---|---|
| Single choice | `single_choice` | One option, one vote |
| Multi choice | `multi_choice` | Many options, pick any subset |
| Approval | `approval` | Yes/No per option |
| Ranked choice | `ranked_choice` | Order all options; tallied via Borda count |

---

## Sidechannel Protocol

| Channel | Purpose |
|---|---|
| `0000tracvote` | Public rendezvous — poll discovery and rebroadcasts |
| `vote:<poll_id>` | Invite-only — per-poll vote collection |

---

## Message Kinds

| Kind | Direction | Meaning |
|---|---|---|
| `vote.poll_announce` | Creator → rendezvous | New poll |
| `vote.poll_rebroadcast` | Creator → rendezvous | Periodic reannounce |
| `vote.cast` | Voter → poll channel | Signed vote envelope |
| `vote.poll_close` | Creator → poll channel | Close voting |
| `vote.tally_publish` | Anyone → poll channel | Verified tally |

---

## Data Locations

| Data | Path |
|---|---|
| Peer keypairs | `stores/<storeName>/db/keypair.json` |
| Poll DB | `onchain/polls/<storeName>.sqlite` |
| SC-Bridge tokens | `onchain/sc-bridge/<storeName>.token` |

---

## Verifiability

The tally is always recomputable:

```js
import { computeTally } from './contract/protocol.js'
const { tally, totalVoters, winnerIds } = computeTally(poll, voteEnvelopes)
```

Dedup rule: last `vote.cast` per `voter_pubkey` wins (allows vote changes before close).

---

## Tests

```bash
npm test
```

All 21 tests must pass before operating on mainnet.

---

## Secrets

- `onchain/` is gitignored — never commit.
- `stores/` is gitignored — never commit.
