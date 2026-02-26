/**
 * TracVote — test/protocol.test.mjs
 *
 * Unit tests for the voting protocol: message builders,
 * validators, tally computation (all four poll types).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPollAnnounce, buildVoteCast, buildPollClose,
  validatePollAnnounce, validateVoteCast,
  computeTally,
  MESSAGE_KINDS, POLL_TYPES, POLL_STATES,
  RENDEZVOUS_CHANNEL, POLL_CHANNEL_PREFIX,
} from '../contract/protocol.js'

const futureSec = (days = 7) => Math.floor(Date.now() / 1000) + days * 86400
const pastSec   = () => Math.floor(Date.now() / 1000) - 3600

const basePoll = () => buildPollAnnounce({
  pollId: 'test-poll-1',
  title: 'Test poll',
  description: 'Testing',
  options: ['Alpha', 'Beta', 'Gamma'],
  pollType: POLL_TYPES.SINGLE_CHOICE,
  creatorPubkey: 'creator-hex',
  endsUnix: futureSec(),
})

// ─── buildPollAnnounce ───────────────────────────────────────────────────────
describe('buildPollAnnounce', () => {
  it('builds correct structure', () => {
    const p = basePoll()
    assert.equal(p.kind, MESSAGE_KINDS.POLL_ANNOUNCE)
    assert.equal(p.poll_id, 'test-poll-1')
    assert.equal(p.title, 'Test poll')
    assert.equal(p.poll_type, POLL_TYPES.SINGLE_CHOICE)
    assert.equal(p.options.length, 3)
    assert.equal(p.options[0].id, '0')
    assert.equal(p.options[0].label, 'Alpha')
    assert.equal(p.vote_channel, `${POLL_CHANNEL_PREFIX}test-poll-1`)
  })

  it('assigns sequential option ids', () => {
    const p = basePoll()
    assert.deepEqual(p.options.map(o => o.id), ['0','1','2'])
  })

  it('throws on fewer than 2 options', () => {
    assert.throws(() => buildPollAnnounce({
      pollId: 'x', title: 'Bad', options: ['Only one'],
      pollType: POLL_TYPES.SINGLE_CHOICE, creatorPubkey: 'c',
      endsUnix: futureSec(),
    }), /at least 2/)
  })
})

// ─── validatePollAnnounce ────────────────────────────────────────────────────
describe('validatePollAnnounce', () => {
  it('passes a valid poll', () => {
    const { valid } = validatePollAnnounce(basePoll())
    assert.equal(valid, true)
  })

  it('rejects wrong kind', () => {
    const { valid } = validatePollAnnounce({ kind: 'other' })
    assert.equal(valid, false)
  })

  it('rejects missing poll_id', () => {
    const p = basePoll(); p.poll_id = ''
    const { valid } = validatePollAnnounce(p)
    assert.equal(valid, false)
  })

  it('rejects past end time', () => {
    const p = basePoll(); p.ends_unix = pastSec()
    const { valid, error } = validatePollAnnounce(p)
    assert.equal(valid, false)
    assert.match(error, /past/)
  })

  it('rejects fewer than 2 options', () => {
    const p = basePoll(); p.options = [{ id:'0', label:'solo' }]
    const { valid } = validatePollAnnounce(p)
    assert.equal(valid, false)
  })

  it('rejects unknown poll_type', () => {
    const p = basePoll(); p.poll_type = 'mystery_vote'
    const { valid } = validatePollAnnounce(p)
    assert.equal(valid, false)
  })
})

// ─── buildVoteCast ───────────────────────────────────────────────────────────
describe('buildVoteCast', () => {
  it('builds correct structure', () => {
    const v = buildVoteCast({ pollId: 'poll-1', voterPubkey: 'voter-hex', choices: ['1'] })
    assert.equal(v.kind, MESSAGE_KINDS.VOTE_CAST)
    assert.equal(v.poll_id, 'poll-1')
    assert.equal(v.voter_pubkey, 'voter-hex')
    assert.deepEqual(v.choices, ['1'])
    assert.equal(v.anonymous, false)
  })

  it('supports anonymous votes', () => {
    const v = buildVoteCast({ pollId: 'poll-1', voterPubkey: 'voter', choices: ['0'], anonymous: true })
    assert.equal(v.voter_pubkey, null)
    assert.equal(v.anonymous, true)
  })

  it('throws on empty choices', () => {
    assert.throws(() => buildVoteCast({ pollId: 'x', voterPubkey: 'v', choices: [] }), /non-empty/)
  })
})

// ─── validateVoteCast ────────────────────────────────────────────────────────
describe('validateVoteCast', () => {
  const poll = basePoll()

  it('passes valid single-choice vote', () => {
    const v = buildVoteCast({ pollId: 'test-poll-1', voterPubkey: 'v', choices: ['1'] })
    const { valid } = validateVoteCast(v, poll)
    assert.equal(valid, true)
  })

  it('rejects unknown option id', () => {
    const v = buildVoteCast({ pollId: 'test-poll-1', voterPubkey: 'v', choices: ['99'] })
    const { valid, error } = validateVoteCast(v, poll)
    assert.equal(valid, false)
    assert.match(error, /unknown option/)
  })

  it('rejects multiple choices on single_choice poll', () => {
    const v = buildVoteCast({ pollId: 'test-poll-1', voterPubkey: 'v', choices: ['0','1'] })
    const { valid } = validateVoteCast(v, poll)
    assert.equal(valid, false)
  })

  it('accepts multiple choices on multi_choice poll', () => {
    const mpoll = buildPollAnnounce({
      pollId: 'mp', title: 'Multi', options: ['A','B','C'],
      pollType: POLL_TYPES.MULTI_CHOICE, creatorPubkey: 'c', endsUnix: futureSec(),
    })
    const v = buildVoteCast({ pollId: 'mp', voterPubkey: 'v', choices: ['0','2'] })
    const { valid } = validateVoteCast(v, mpoll)
    assert.equal(valid, true)
  })

  it('rejects incomplete ranked_choice (must rank all)', () => {
    const rpoll = buildPollAnnounce({
      pollId: 'rp', title: 'Rank', options: ['A','B','C'],
      pollType: POLL_TYPES.RANKED_CHOICE, creatorPubkey: 'c', endsUnix: futureSec(),
    })
    const v = buildVoteCast({ pollId: 'rp', voterPubkey: 'v', choices: ['0','1'] }) // missing '2'
    const { valid } = validateVoteCast(v, rpoll)
    assert.equal(valid, false)
  })
})

// ─── computeTally ────────────────────────────────────────────────────────────
describe('computeTally — single_choice', () => {
  const poll = basePoll()
  const votes = [
    { voter_pubkey:'a', choices:['0'], ts:1 },
    { voter_pubkey:'b', choices:['0'], ts:2 },
    { voter_pubkey:'c', choices:['1'], ts:3 },
    { voter_pubkey:'d', choices:['2'], ts:4 },
  ]

  it('counts votes correctly', () => {
    const { tally } = computeTally(poll, votes)
    assert.equal(tally['0'], 2)
    assert.equal(tally['1'], 1)
    assert.equal(tally['2'], 1)
  })

  it('identifies correct winner', () => {
    const { winnerIds } = computeTally(poll, votes)
    assert.deepEqual(winnerIds, ['0'])
  })

  it('counts total voters', () => {
    const { totalVoters } = computeTally(poll, votes)
    assert.equal(totalVoters, 4)
  })

  it('deduplicates: last vote per pubkey wins', () => {
    const votesWithDupe = [
      { voter_pubkey:'a', choices:['1'], ts:1 }, // first vote: option 1
      { voter_pubkey:'a', choices:['2'], ts:2 }, // changed to option 2
    ]
    const { tally, totalVoters } = computeTally(poll, votesWithDupe)
    assert.equal(tally['1'], 0)
    assert.equal(tally['2'], 1)
    assert.equal(totalVoters, 1) // only 1 unique voter
  })
})

describe('computeTally — multi_choice', () => {
  const poll = buildPollAnnounce({
    pollId: 'mp', title: 'Multi', options: ['A','B','C'],
    pollType: POLL_TYPES.MULTI_CHOICE, creatorPubkey: 'c', endsUnix: futureSec(),
  })
  const votes = [
    { voter_pubkey:'x', choices:['0','1'], ts:1 },
    { voter_pubkey:'y', choices:['1','2'], ts:2 },
  ]

  it('counts multi-choice votes', () => {
    const { tally } = computeTally(poll, votes)
    assert.equal(tally['0'], 1)
    assert.equal(tally['1'], 2)
    assert.equal(tally['2'], 1)
  })
})

describe('computeTally — ranked_choice (Borda)', () => {
  const poll = buildPollAnnounce({
    pollId: 'rp', title: 'Rank', options: ['A','B','C'],
    pollType: POLL_TYPES.RANKED_CHOICE, creatorPubkey: 'c', endsUnix: futureSec(),
  })
  // 3 options → max 2 pts for 1st, 1 for 2nd, 0 for 3rd
  const votes = [
    { voter_pubkey:'a', choices:['0','1','2'], ts:1 }, // A=2, B=1, C=0
    { voter_pubkey:'b', choices:['0','2','1'], ts:2 }, // A=2, B=0, C=1
    { voter_pubkey:'c', choices:['1','0','2'], ts:3 }, // A=1, B=2, C=0
  ]

  it('computes Borda points correctly', () => {
    const { tally } = computeTally(poll, votes)
    // A: 2+2+1=5, B: 1+0+2=3, C: 0+1+0=1
    assert.equal(tally['0'], 5)
    assert.equal(tally['1'], 3)
    assert.equal(tally['2'], 1)
  })

  it('picks Borda winner', () => {
    const { winnerIds } = computeTally(poll, votes)
    assert.deepEqual(winnerIds, ['0'])
  })
})

describe('computeTally — empty poll', () => {
  it('returns all zeros on no votes', () => {
    const poll = basePoll()
    const { tally, totalVoters, winnerIds } = computeTally(poll, [])
    assert.deepEqual(tally, { '0':0, '1':0, '2':0 })
    assert.equal(totalVoters, 0)
    assert.deepEqual(winnerIds, [])
  })
})
