/**
 * TracVote — src/store.js
 *
 * Local SQLite persistence for polls, votes, and tallies.
 * The tally is always recomputable from raw votes — the store
 * is a cache, not a source of truth.
 */

import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { computeTally } from '../contract/protocol.js'

export class VoteStore {
  constructor(storeName, baseDir = 'onchain/polls') {
    mkdirSync(baseDir, { recursive: true })
    this.db = new Database(join(baseDir, `${storeName}.sqlite`))
    this._migrate()
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS polls (
        poll_id       TEXT PRIMARY KEY,
        title         TEXT NOT NULL,
        description   TEXT DEFAULT '',
        options_json  TEXT NOT NULL,
        poll_type     TEXT NOT NULL DEFAULT 'single_choice',
        creator_pubkey TEXT NOT NULL,
        ends_unix     INTEGER NOT NULL,
        allow_anonymous INTEGER DEFAULT 0,
        quorum        INTEGER DEFAULT 0,
        vote_channel  TEXT NOT NULL,
        state         TEXT NOT NULL DEFAULT 'open',
        created_at    INTEGER DEFAULT (unixepoch()),
        closed_at     INTEGER
      );

      CREATE TABLE IF NOT EXISTS votes (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        poll_id       TEXT NOT NULL,
        voter_pubkey  TEXT,
        choices_json  TEXT NOT NULL,
        anonymous     INTEGER DEFAULT 0,
        received_at   INTEGER DEFAULT (unixepoch()),
        FOREIGN KEY (poll_id) REFERENCES polls(poll_id)
      );

      CREATE TABLE IF NOT EXISTS tallies (
        poll_id       TEXT PRIMARY KEY,
        tally_json    TEXT NOT NULL,
        total_voters  INTEGER NOT NULL,
        winner_ids_json TEXT NOT NULL,
        computed_at   INTEGER DEFAULT (unixepoch()),
        FOREIGN KEY (poll_id) REFERENCES polls(poll_id)
      );

      CREATE INDEX IF NOT EXISTS idx_votes_poll ON votes(poll_id);
      CREATE INDEX IF NOT EXISTS idx_polls_state ON polls(state);
    `)
  }

  upsertPoll(msg) {
    this.db.prepare(`
      INSERT INTO polls (poll_id, title, description, options_json, poll_type,
        creator_pubkey, ends_unix, allow_anonymous, quorum, vote_channel)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(poll_id) DO UPDATE SET
        title=excluded.title,
        description=excluded.description
    `).run(
      msg.poll_id, msg.title, msg.description,
      JSON.stringify(msg.options), msg.poll_type,
      msg.creator_pubkey, msg.ends_unix,
      msg.allow_anonymous ? 1 : 0, msg.quorum || 0,
      msg.vote_channel
    )
  }

  recordVote(msg) {
    // Upsert: replace existing vote from same voter on same poll
    if (msg.voter_pubkey) {
      this.db.prepare(`
        DELETE FROM votes WHERE poll_id=? AND voter_pubkey=?
      `).run(msg.poll_id, msg.voter_pubkey)
    }
    this.db.prepare(`
      INSERT INTO votes (poll_id, voter_pubkey, choices_json, anonymous)
      VALUES (?,?,?,?)
    `).run(msg.poll_id, msg.voter_pubkey || null, JSON.stringify(msg.choices), msg.anonymous ? 1 : 0)
  }

  closePoll(pollId) {
    this.db.prepare(`
      UPDATE polls SET state='closed', closed_at=unixepoch() WHERE poll_id=?
    `).run(pollId)
  }

  computeAndStoreTally(pollId) {
    const poll = this.getPoll(pollId)
    if (!poll) return null
    const votes = this.getVotes(pollId)
    const { tally, totalVoters, winnerIds } = computeTally(poll, votes)
    this.db.prepare(`
      INSERT INTO tallies (poll_id, tally_json, total_voters, winner_ids_json)
      VALUES (?,?,?,?)
      ON CONFLICT(poll_id) DO UPDATE SET
        tally_json=excluded.tally_json,
        total_voters=excluded.total_voters,
        winner_ids_json=excluded.winner_ids_json,
        computed_at=unixepoch()
    `).run(pollId, JSON.stringify(tally), totalVoters, JSON.stringify(winnerIds))
    this.db.prepare(`UPDATE polls SET state='tallied' WHERE poll_id=?`).run(pollId)
    return { tally, totalVoters, winnerIds }
  }

  getPoll(pollId) {
    const r = this.db.prepare('SELECT * FROM polls WHERE poll_id=?').get(pollId)
    if (!r) return null
    return { ...r, options: JSON.parse(r.options_json) }
  }

  getOpenPolls() {
    return this.db.prepare(`
      SELECT p.*, (SELECT COUNT(*) FROM votes v WHERE v.poll_id=p.poll_id) as vote_count
      FROM polls p
      WHERE p.state='open' AND p.ends_unix > unixepoch()
      ORDER BY p.ends_unix ASC
    `).all().map(r => ({ ...r, options: JSON.parse(r.options_json) }))
  }

  getAllPolls() {
    return this.db.prepare(`
      SELECT p.*, (SELECT COUNT(*) FROM votes v WHERE v.poll_id=p.poll_id) as vote_count
      FROM polls p ORDER BY p.created_at DESC
    `).all().map(r => ({ ...r, options: JSON.parse(r.options_json) }))
  }

  getVotes(pollId) {
    return this.db.prepare('SELECT * FROM votes WHERE poll_id=? ORDER BY received_at ASC')
      .all(pollId)
      .map(r => ({ ...r, choices: JSON.parse(r.choices_json) }))
  }

  getTally(pollId) {
    const r = this.db.prepare('SELECT * FROM tallies WHERE poll_id=?').get(pollId)
    if (!r) return null
    return {
      tally: JSON.parse(r.tally_json),
      totalVoters: r.total_voters,
      winnerIds: JSON.parse(r.winner_ids_json),
      computedAt: r.computed_at,
    }
  }

  getMyVote(pollId, myPubkey) {
    return this.db.prepare('SELECT * FROM votes WHERE poll_id=? AND voter_pubkey=?')
      .get(pollId, myPubkey)
  }

  close() { this.db.close() }
}
