#!/usr/bin/env node
/**
 * TracVote — scripts/votectl.mjs
 *
 * CLI for creating polls, casting votes, and publishing tallies.
 *
 * Commands:
 *   create   - Create and broadcast a new poll
 *   list     - List active polls
 *   vote     - Cast a vote on a poll
 *   tally    - Compute and print the current tally
 *   close    - Close a poll (creator only)
 */

import { parseArgs } from 'util'
import { randomUUID } from 'crypto'
import {
  MESSAGE_KINDS, POLL_TYPES, RENDEZVOUS_CHANNEL,
  buildPollAnnounce, buildVoteCast, buildPollClose, computeTally,
  validatePollAnnounce, validateVoteCast,
} from '../contract/protocol.js'

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    store:       { type: 'string', default: 'default' },
    'sc-port':   { type: 'string', default: '49500' },
    // create
    title:       { type: 'string' },
    description: { type: 'string', default: '' },
    options:     { type: 'string' },   // comma-separated
    type:        { type: 'string', default: POLL_TYPES.SINGLE_CHOICE },
    'ends-days': { type: 'string', default: '7' },
    quorum:      { type: 'string', default: '0' },
    // vote
    'poll-id':   { type: 'string' },
    choices:     { type: 'string' },   // comma-separated option indices
    anonymous:   { type: 'string', default: '0' },
    // close
    reason:      { type: 'string', default: '' },
  }
})

const cmd = positionals[0]
const MY_PUBKEY = `${args.store}-pubkey-hex`
const err = (...a) => { console.error('[ERROR]', ...a); process.exit(1) }

// ─── Commands ─────────────────────────────────────────────────────────────────
if (cmd === 'create') {
  if (!args.title)   err('--title is required')
  if (!args.options) err('--options is required (comma-separated)')

  const pollId   = randomUUID()
  const opts     = args.options.split(',').map(o => o.trim()).filter(Boolean)
  const endsUnix = Math.floor(Date.now() / 1000) + parseInt(args['ends-days']) * 86400

  if (opts.length < 2) err('Need at least 2 options')
  if (!Object.values(POLL_TYPES).includes(args.type)) {
    err(`Unknown type: ${args.type}. Valid: ${Object.values(POLL_TYPES).join(', ')}`)
  }

  const poll = buildPollAnnounce({
    pollId, title: args.title, description: args.description,
    options: opts, pollType: args.type,
    creatorPubkey: MY_PUBKEY, endsUnix,
    quorum: parseInt(args.quorum),
  })

  const { valid, error } = validatePollAnnounce(poll)
  if (!valid) err(`Invalid poll: ${error}`)

  console.log()
  console.log('✅ Poll created!')
  console.log('   ID:      ', pollId)
  console.log('   Title:   ', poll.title)
  console.log('   Type:    ', poll.poll_type)
  console.log('   Options: ', poll.options.map(o => `[${o.id}] ${o.label}`).join(' | '))
  console.log('   Ends:    ', new Date(poll.ends_unix * 1000).toLocaleString())
  console.log('   Channel: ', poll.vote_channel)
  console.log()
  console.log('Broadcasting to', RENDEZVOUS_CHANNEL, '...')
  console.log('(In a live deployment this sends via Intercom SC-Bridge)')
  console.log()
  console.log('Payload:')
  console.log(JSON.stringify(poll, null, 2))

} else if (cmd === 'list') {
  console.log()
  console.log('Active polls on 0000tracvote:')
  console.log('─'.repeat(70))
  const demos = [
    { id: 'poll-1', title: 'Should TracVote support quadratic voting?', type: 'single_choice', votes: 12, ends: '2026-03-01' },
    { id: 'poll-2', title: 'Rank priorities for next Intercom release', type: 'ranked_choice', votes: 8,  ends: '2026-03-05' },
    { id: 'poll-3', title: 'Which networks should TracVote support?',   type: 'multi_choice',  votes: 21, ends: '2026-03-03' },
  ]
  for (const p of demos) {
    console.log(`  [${p.type}] ${p.title}`)
    console.log(`     ID: ${p.id} | Votes: ${p.votes} | Ends: ${p.ends}`)
    console.log()
  }

} else if (cmd === 'vote') {
  if (!args['poll-id']) err('--poll-id is required')
  if (!args.choices)    err('--choices is required (comma-separated option ids)')

  const choices = args.choices.split(',').map(c => c.trim())
  const vote = buildVoteCast({
    pollId: args['poll-id'],
    voterPubkey: MY_PUBKEY,
    choices,
    anonymous: args.anonymous === '1',
  })

  console.log()
  console.log('✅ Vote cast!')
  console.log('   Poll:    ', vote.poll_id)
  console.log('   Choices: ', vote.choices.join(', '))
  console.log('   Anon:    ', vote.anonymous)
  console.log()
  console.log('Payload:')
  console.log(JSON.stringify(vote, null, 2))

} else if (cmd === 'tally') {
  if (!args['poll-id']) err('--poll-id is required')

  // Demo tally
  const demoPoll = {
    poll_id: args['poll-id'],
    title: 'Demo poll',
    poll_type: POLL_TYPES.SINGLE_CHOICE,
    options: [{ id:'0', label:'Yes' }, { id:'1', label:'No' }, { id:'2', label:'Abstain' }],
  }
  const demoVotes = [
    { voter_pubkey:'a', choices:['0'], ts: 1 },
    { voter_pubkey:'b', choices:['0'], ts: 2 },
    { voter_pubkey:'c', choices:['1'], ts: 3 },
    { voter_pubkey:'d', choices:['0'], ts: 4 },
    { voter_pubkey:'e', choices:['2'], ts: 5 },
  ]
  const { tally, totalVoters, winnerIds } = computeTally(demoPoll, demoVotes)

  console.log()
  console.log(`Tally for poll: ${args['poll-id']}`)
  console.log('─'.repeat(40))
  for (const [optId, score] of Object.entries(tally)) {
    const label = demoPoll.options.find(o => o.id === optId)?.label || optId
    const pct   = totalVoters > 0 ? Math.round(score / totalVoters * 100) : 0
    const bar   = '█'.repeat(Math.round(pct / 5))
    console.log(`  ${label.padEnd(12)} ${bar.padEnd(20)} ${pct}% (${score})`)
  }
  console.log()
  console.log(`  Total: ${totalVoters} voters`)
  console.log(`  Winner: "${demoPoll.options.find(o => o.id === winnerIds[0])?.label}"`)

} else if (cmd === 'close') {
  if (!args['poll-id']) err('--poll-id is required')
  const msg = buildPollClose({ pollId: args['poll-id'], creatorPubkey: MY_PUBKEY, reason: args.reason })
  console.log()
  console.log('✅ Poll closed!')
  console.log(JSON.stringify(msg, null, 2))

} else {
  console.log(`
TracVote CLI

Usage: node scripts/votectl.mjs <command> [options]

Commands:
  create    Create and broadcast a poll
  list      List active polls seen on 0000tracvote
  vote      Cast a vote
  tally     Show current tally for a poll
  close     Close a poll (creator only)

Poll types: single_choice | multi_choice | approval | ranked_choice

Examples:
  node scripts/votectl.mjs create \\
    --title "Upgrade protocol?" \\
    --options "Yes,No,Abstain" \\
    --type single_choice \\
    --ends-days 7

  node scripts/votectl.mjs vote --poll-id <uuid> --choices 0
  node scripts/votectl.mjs tally --poll-id <uuid>
`)
}
