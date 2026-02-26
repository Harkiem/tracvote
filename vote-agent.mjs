#!/usr/bin/env node
/**
 * TracVote — scripts/vote-agent.mjs
 *
 * Headless voting agent. Runs on the Intercom network, discovers
 * polls in the 0000tracvote rendezvous channel, and can auto-vote
 * based on configured preferences.
 *
 * In a live deployment this connects to an Intercom peer's SC-Bridge
 * via WebSocket. Here we simulate the protocol to demonstrate correctness.
 *
 * Usage:
 *   node scripts/vote-agent.mjs --store agent1 --sc-port 49500 \
 *     --role voter --auto-vote 1
 */

import { parseArgs } from 'util'
import { randomUUID } from 'crypto'
import {
  RENDEZVOUS_CHANNEL, MESSAGE_KINDS, POLL_TYPES,
  buildPollAnnounce, buildVoteCast, computeTally,
  validatePollAnnounce, validateVoteCast,
} from '../contract/protocol.js'

const { values: args } = parseArgs({
  options: {
    store:      { type: 'string', default: 'agent1' },
    'sc-port':  { type: 'string', default: '49500' },
    role:       { type: 'string', default: 'voter' }, // voter | creator
    'auto-vote':{ type: 'string', default: '0' },
    debug:      { type: 'string', default: '0' },
  }
})

const DEBUG    = args.debug === '1'
const autoVote = args['auto-vote'] === '1'
const log      = (...a) => console.log('[TracVote Agent]', ...a)
const dbg      = (...a) => DEBUG && console.log('[DBG]', ...a)
const MY_KEY   = `${args.store}-pubkey-hex`

// In-memory poll state (would be backed by VoteStore in live deployment)
const polls = new Map()      // poll_id → announce msg
const myVotes = new Set()    // poll_ids I've voted on

// ─── Message handler ──────────────────────────────────────────────────────────
function handleMessage(msg) {
  dbg('msg:', msg.kind)

  if (msg.kind === MESSAGE_KINDS.POLL_ANNOUNCE) {
    const { valid, error } = validatePollAnnounce(msg)
    if (!valid) { log(`[SKIP] Invalid announce: ${error}`); return }

    const endsIn = Math.ceil((msg.ends_unix - Date.now()/1000) / 3600)
    log(`[POLL]  "${msg.title}"`)
    log(`        Type: ${msg.poll_type} | Options: ${msg.options.map(o => o.label).join(', ')}`)
    log(`        Closes in: ${endsIn}h | Channel: ${msg.vote_channel}`)
    polls.set(msg.poll_id, msg)

    if (args.role === 'voter' && autoVote && !myVotes.has(msg.poll_id)) {
      // Auto-vote: pick the first option for demo purposes
      const choice = [msg.options[0].id]
      const vote = buildVoteCast({ pollId: msg.poll_id, voterPubkey: MY_KEY, choices: choice })
      const { valid: vv, error: ve } = validateVoteCast(vote, msg)
      if (vv) {
        log(`[VOTE]  Auto-voting "${msg.options[0].label}" on "${msg.title}"`)
        myVotes.add(msg.poll_id)
      } else {
        log(`[WARN]  Invalid auto-vote: ${ve}`)
      }
    }
    return
  }

  if (msg.kind === MESSAGE_KINDS.VOTE_CAST) {
    const poll = polls.get(msg.poll_id)
    if (!poll) return
    const labels = msg.choices.map(id => poll.options.find(o => o.id === id)?.label || id)
    log(`[CAST]  Vote received on "${poll.title}" → ${labels.join(', ')}`)
    return
  }

  if (msg.kind === MESSAGE_KINDS.POLL_CLOSE) {
    const poll = polls.get(msg.poll_id)
    if (!poll) return
    log(`[CLOSE] Poll closed: "${poll.title}"`)
    return
  }

  if (msg.kind === MESSAGE_KINDS.TALLY_PUBLISH) {
    log(`[TALLY] Results for poll ${msg.poll_id}:`)
    for (const [optId, score] of Object.entries(msg.tally)) {
      const label = msg.options?.find?.(o => o.id === optId)?.label || optId
      log(`        ${label}: ${score}`)
    }
    log(`        Winners: ${msg.winner_ids?.join(', ')} | Total voters: ${msg.total_voters}`)
    return
  }

  dbg('Unhandled kind:', msg.kind)
}

// ─── Demo: simulate a live session ───────────────────────────────────────────
const nowSec = Math.floor(Date.now() / 1000)

const demoPolls = [
  buildPollAnnounce({
    pollId: randomUUID(),
    title: 'Should TracVote support quadratic voting?',
    description: 'Governance vote on adding quadratic voting as a new poll_type.',
    options: ['Yes — add it', 'No — keep it simple', 'Yes but later'],
    pollType: POLL_TYPES.SINGLE_CHOICE,
    creatorPubkey: 'governance-peer-pubkey',
    endsUnix: nowSec + 86400 * 3,
  }),
  buildPollAnnounce({
    pollId: randomUUID(),
    title: 'Rank priorities for next Intercom release',
    description: 'Help the core team prioritise the roadmap.',
    options: ['Performance', 'New features', 'Documentation', 'Security'],
    pollType: POLL_TYPES.RANKED_CHOICE,
    creatorPubkey: 'core-team-pubkey',
    endsUnix: nowSec + 86400 * 7,
  }),
  buildPollAnnounce({
    pollId: randomUUID(),
    title: 'Which networks should TracVote support for settlement?',
    description: 'Multi-select: pick all that apply.',
    options: ['Trac Network', 'Bitcoin Lightning', 'Solana', 'Ethereum'],
    pollType: POLL_TYPES.MULTI_CHOICE,
    creatorPubkey: 'community-peer-pubkey',
    endsUnix: nowSec + 86400 * 5,
  }),
]

// Simulate some existing votes for tally demo
const demoVotes = [
  buildVoteCast({ pollId: demoPolls[0].poll_id, voterPubkey: 'peer-aaa', choices: ['0'] }),
  buildVoteCast({ pollId: demoPolls[0].poll_id, voterPubkey: 'peer-bbb', choices: ['0'] }),
  buildVoteCast({ pollId: demoPolls[0].poll_id, voterPubkey: 'peer-ccc', choices: ['2'] }),
]

log('─'.repeat(60))
log(`Store:     ${args.store}`)
log(`Role:      ${args.role}`)
log(`Auto-vote: ${autoVote}`)
log(`Channel:   ${RENDEZVOUS_CHANNEL}`)
log('─'.repeat(60))
log()
log('Connecting to Intercom peer...')
await new Promise(r => setTimeout(r, 400))
log('Joined rendezvous channel: 0000tracvote')
log('Listening for polls...')
log()

for (const poll of demoPolls) {
  await new Promise(r => setTimeout(r, 700))
  handleMessage(poll)
}

log()
log('─'.repeat(60))
log('Simulating incoming votes on poll 1...')
log('─'.repeat(60))
for (const vote of demoVotes) {
  await new Promise(r => setTimeout(r, 300))
  handleMessage(vote)
}

// Compute and show tally
const poll0 = demoPolls[0]
await new Promise(r => setTimeout(r, 500))
const { tally, totalVoters, winnerIds } = computeTally(poll0, demoVotes)
log()
log('─'.repeat(60))
log('TALLY for "' + poll0.title + '"')
log('─'.repeat(60))
for (const [optId, score] of Object.entries(tally)) {
  const label = poll0.options.find(o => o.id === optId)?.label || optId
  const bar = '█'.repeat(score) + '░'.repeat(Math.max(0, totalVoters - score))
  log(`  ${label.padEnd(30)} ${bar} ${score}`)
}
log()
log(`  Total voters: ${totalVoters} | Winner: "${poll0.options.find(o => o.id === winnerIds[0])?.label}"`)
log()
log('Agent running... (Ctrl+C to stop)')

setInterval(() => dbg('heartbeat'), 30_000)
