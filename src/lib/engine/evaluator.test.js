// Tests for the evaluator + difficulty profiles. Run with: npm test

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { leaveValue, chooseMove, chooseMoveFor, PROFILES } from './evaluator.js'
import { buildDictionary } from './dictionary.js'
import { generateMoves } from './generator.js'
import { createEmptyBoard } from '../boardData.js'

// A fixed rng so positional/noise picks are deterministic. 0.99 dodges the
// noise branch (rng < noise is false for every profile) and lands picks at
// the high end of any band.
const rngHigh = () => 0.99

// ── leave heuristic ──────────────────────────────────────────

test('leaveValue: rewards blank/S, penalizes a lone Q', () => {
  assert.equal(leaveValue([]), 0)
  assert.equal(leaveValue(['?']), 25)
  assert.equal(leaveValue(['S']), 8)
  assert.ok(leaveValue(['?']) > leaveValue(['S']))
  // Q alone: base -6 plus -4 for "Q with no U" = -10
  assert.equal(leaveValue(['Q']), -10)
  // a U rescues it: -6 + (-2 for U) = -8, no lone-Q penalty
  assert.equal(leaveValue(['Q', 'U']), -8)
  assert.ok(leaveValue(['Q', 'U']) > leaveValue(['Q']))
})

// ── selection ────────────────────────────────────────────────

test('expert weighs the leave (equity), not just raw score', () => {
  // Lower raw score but a far better leave should win for the expert.
  const moves = [
    { score: 30, leave: ['Q'], words: ['AA'], bingo: false }, // equity 30 + (-10) = 20
    { score: 24, leave: ['S'], words: ['BB'], bingo: false }, // equity 24 + 8    = 32
  ]
  // rng 0.4 dodges Claudette's bingoSkip (0.30) and noise (0.03) and floors her
  // top-K pick to index 0 — so we test the equity ranking, not the off-pick.
  const pick = chooseMove(moves, PROFILES.claudette, { rng: () => 0.4 })
  assert.equal(pick.score, 24, 'expert prefers the better-leave play')
})

test('hard/merlin maximizes raw score (top of the ranking)', () => {
  const moves = [
    { score: 30, leave: ['Q'], words: ['AA'], bingo: false },
    { score: 24, leave: ['S'], words: ['BB'], bingo: false },
  ]
  // topK with rngHigh*topK floors into the top band; with only 2 moves and
  // 0.99*min(4,2)=1 → index 1. Use rng=0 to take the very top deterministically.
  const pick = chooseMove(moves, PROFILES.merlin, { rng: () => 0 })
  assert.equal(pick.score, 30, 'hard takes the highest raw score')
})

test('easy/robin refuses bingos and long words (vocabulary cap)', () => {
  const moves = [
    { score: 80, leave: [], words: ['RETAINS'], bingo: true },   // 7 letters, bingo
    { score: 18, leave: ['A', 'E'], words: ['QUICK'], bingo: false }, // 5 letters
    { score: 10, leave: ['A', 'E', 'T'], words: ['CAT'], bingo: false }, // 3 letters
  ]
  for (let i = 0; i < 20; i++) {
    const pick = chooseMove(moves, PROFILES.robin, { rng: Math.random })
    assert.ok(!pick.bingo, 'robin never plays a bingo')
    assert.ok(pick.words.every(w => w.length <= 5), 'robin never plays >5-letter words')
  }
})

test('falls back to full pool if the cap filters everything out', () => {
  // Only a bingo available — robin must still be able to move.
  const moves = [{ score: 80, leave: [], words: ['RETAINS'], bingo: true }]
  const pick = chooseMove(moves, PROFILES.robin, { rng: rngHigh })
  assert.ok(pick, 'returns a move rather than null when the cap empties the pool')
})

test('no moves → null (caller handles pass/exchange)', () => {
  assert.equal(chooseMove([], PROFILES.claudette, { rng: rngHigh }), null)
  assert.equal(chooseMoveFor([], 'claudette', { rng: rngHigh }), null)
})

test('chooseMoveFor rejects an unknown character', () => {
  assert.throws(() => chooseMoveFor([], 'pigeon', { rng: rngHigh }), /Unknown character/)
})

// ── integration with the real generator + word list ─────────

test('integration: each character returns a legal play within its limits', () => {
  const text = readFileSync(new URL('../../../public/words.txt', import.meta.url), 'utf8')
  const dict = buildDictionary(text.split('\n'))
  const board = createEmptyBoard()
  const moves = generateMoves(board, ['R', 'E', 'T', 'A', 'I', 'N', 'S'], dict, { layoutVersion: 2 })

  const claud = chooseMoveFor(moves, 'claudette', { rng: rngHigh })
  const robin = chooseMoveFor(moves, 'robin', { rng: rngHigh })

  assert.ok(claud && robin)
  // Claudette should land a strong play (these racks bingo readily).
  assert.ok(claud.score >= robin.score, 'expert scores at least as high as easy')
  // Robin stays within her cap.
  assert.ok(robin.words.every(w => w.length <= 5), 'robin keeps it short')
  assert.ok(!robin.bingo)
})
