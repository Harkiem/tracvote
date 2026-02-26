/**
 * TracVote — contract/protocol.js
 *
 * Defines the P2P voting/polling protocol on top of Intercom sidechannels.
 * Polls are broadcast to a shared rendezvous channel. Votes arrive in
 * invite-only per-poll channels. Tallies are deterministic and verifiable
 * from the signed envelope log — no trusted tallier required.
 *
 * Fork of: Trac-Systems/intercom
 */

export const RENDEZVOUS_CHANNEL = '0000tracvote'
export const POLL_CHANNEL_PREFIX = 'vote:'

export const MESSAGE_KINDS = {
  // Creator → rendezvous: announce a new poll
  POLL_ANNOUNCE:  'vote.poll_announce',
  // Voter → poll channel: cast a vote
  VOTE_CAST:      'vote.cast',
  // Creator → poll channel: close voting
  POLL_CLOSE:     'vote.poll_close',
  // Anyone → poll channel: publish computed tally
  TALLY_PUBLISH:  'vote.tally_publish',
  // Creator → rendezvous: rebroadcast open poll (sidechannels have no history)
  POLL_REBROADCAST: 'vote.poll_rebroadcast',
}

export const POLL_TYPES = {
  SINGLE_CHOICE:   'single_choice',   // pick exactly one option
  MULTI_CHOICE:    'multi_choice',    // pick one or more options
  APPROVAL:        'approval',        // yes/no per option
  RANKED_CHOICE:   'ranked_choice',   // order options by preference
}

export const POLL_STATES = {
  OPEN:    'open',
  CLOSED:  'closed',
  TALLIED: 'tallied',
}

/**
 * Build a vote.poll_announce payload.
 */
export function buildPollAnnounce({
  pollId,
  title,
  description = '',
  options,
  pollType = POLL_TYPES.SINGLE_CHOICE,
  creatorPubkey,
  endsUnix,
  allowAnonymous = false,
  quorum = 0,
}) {
  if (!Array.isArray(options) || options.length < 2) {
    throw new Error('Poll must have at least 2 options')
  }
  return {
    kind: MESSAGE_KINDS.POLL_ANNOUNCE,
    poll_id: pollId,
    title,
    description,
    options: options.map((o, i) => ({ id: String(i), label: o })),
    poll_type: pollType,
    creator_pubkey: creatorPubkey,
    ends_unix: endsUnix,
    allow_anonymous: allowAnonymous,
    quorum,
    vote_channel: `${POLL_CHANNEL_PREFIX}${pollId}`,
    ts: Date.now(),
  }
}

/**
 * Build a vote.cast payload.
 * choices: for single/approval → ['0'], for multi → ['0','2'], for ranked → ['2','0','1']
 */
export function buildVoteCast({ pollId, voterPubkey, choices, anonymous = false }) {
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('choices must be a non-empty array of option ids')
  }
  return {
    kind: MESSAGE_KINDS.VOTE_CAST,
    poll_id: pollId,
    voter_pubkey: anonymous ? null : voterPubkey,
    choices,
    anonymous,
    ts: Date.now(),
  }
}

/**
 * Build a vote.poll_close payload (creator only).
 */
export function buildPollClose({ pollId, creatorPubkey, reason = '' }) {
  return {
    kind: MESSAGE_KINDS.POLL_CLOSE,
    poll_id: pollId,
    creator_pubkey: creatorPubkey,
    reason,
    ts: Date.now(),
  }
}

/**
 * Compute tally from a list of signed vote envelopes.
 * Returns { optionId → count } for single/multi/approval,
 * or { optionId → points } for ranked_choice (Borda count).
 *
 * @param {object} poll - the poll_announce payload
 * @param {object[]} votes - array of vote.cast payloads
 * @returns {{ tally: object, totalVoters: number, winnerIds: string[] }}
 */
export function computeTally(poll, votes) {
  const tally = {}
  for (const opt of poll.options) tally[opt.id] = 0

  // Deduplicate: last vote per voter_pubkey wins (allows vote changes before close)
  const deduped = new Map()
  for (const v of votes) {
    const key = v.voter_pubkey || `anon:${v.ts}:${Math.random()}`
    deduped.set(key, v)
  }

  const validVotes = [...deduped.values()]

  for (const vote of validVotes) {
    if (poll.poll_type === POLL_TYPES.RANKED_CHOICE) {
      // Borda count: n-1 points for 1st place, n-2 for 2nd, etc.
      const n = poll.options.length
      vote.choices.forEach((optId, rank) => {
        if (tally[optId] !== undefined) {
          tally[optId] += (n - 1 - rank)
        }
      })
    } else {
      // single, multi, approval: each choice = 1 point
      for (const optId of vote.choices) {
        if (tally[optId] !== undefined) {
          tally[optId] += 1
        }
      }
    }
  }

  const maxScore = Math.max(...Object.values(tally))
  const winnerIds = Object.entries(tally)
    .filter(([, score]) => score === maxScore && maxScore > 0)
    .map(([id]) => id)

  return { tally, totalVoters: validVotes.length, winnerIds }
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validatePollAnnounce(msg) {
  if (!msg || msg.kind !== MESSAGE_KINDS.POLL_ANNOUNCE) return { valid: false, error: 'wrong kind' }
  if (!msg.poll_id) return { valid: false, error: 'missing poll_id' }
  if (!msg.title || typeof msg.title !== 'string') return { valid: false, error: 'missing title' }
  if (!Array.isArray(msg.options) || msg.options.length < 2) return { valid: false, error: 'need at least 2 options' }
  if (!msg.creator_pubkey) return { valid: false, error: 'missing creator_pubkey' }
  if (!msg.ends_unix || typeof msg.ends_unix !== 'number') return { valid: false, error: 'invalid ends_unix' }
  if (msg.ends_unix < Date.now() / 1000) return { valid: false, error: 'end time in the past' }
  if (!Object.values(POLL_TYPES).includes(msg.poll_type)) return { valid: false, error: `unknown poll_type: ${msg.poll_type}` }
  return { valid: true }
}

export function validateVoteCast(msg, poll) {
  if (!msg || msg.kind !== MESSAGE_KINDS.VOTE_CAST) return { valid: false, error: 'wrong kind' }
  if (!msg.poll_id) return { valid: false, error: 'missing poll_id' }
  if (!Array.isArray(msg.choices) || msg.choices.length === 0) return { valid: false, error: 'empty choices' }

  if (poll) {
    const validOptionIds = new Set(poll.options.map(o => o.id))
    for (const c of msg.choices) {
      if (!validOptionIds.has(c)) return { valid: false, error: `unknown option id: ${c}` }
    }
    if (poll.poll_type === POLL_TYPES.SINGLE_CHOICE && msg.choices.length !== 1) {
      return { valid: false, error: 'single_choice polls accept exactly one choice' }
    }
    if (poll.poll_type === POLL_TYPES.RANKED_CHOICE && msg.choices.length !== poll.options.length) {
      return { valid: false, error: 'ranked_choice must rank all options' }
    }
  }

  return { valid: true }
}
