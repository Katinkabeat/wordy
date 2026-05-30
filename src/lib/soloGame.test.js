// Tests for the local Solo game loop. Run with: npm test

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  initSoloGame, applyPlay, applyPass, applyExchange, botDecide, applyBotAction, isBoardEmpty,
} from './soloGame.js'
import { buildDictionary } from './engine/index.js'

const seats = [{ characterId: 'robin', name: 'Robin' }]

test('initSoloGame: seats one human + the bots, full racks, correct bag', () => {
  const s = initSoloGame({ humanId: 'me', humanName: 'Rae', seats })
  assert.equal(s.players.length, 2)
  assert.equal(s.players[0].isBot, false)
  assert.equal(s.players[1].isBot, true)
  assert.equal(s.players[1].characterId, 'robin')
  assert.equal(s.players[0].rack.length, 7)
  assert.equal(s.players[1].rack.length, 7)
  assert.equal(s.tileBag.length, 100 - 14) // 100-tile bag minus two full racks
  assert.equal(s.currentPlayerIdx, 0)
  assert.equal(s.status, 'active')
  assert.ok(isBoardEmpty(s.board))
  assert.equal(s.profiles.me.username, 'Rae')
  assert.equal(s.profiles['bot-robin-1'].username, 'Robin')
})

test('applyPlay: scores, refills the rack, advances the turn, resets passes', () => {
  let s = initSoloGame({ humanId: 'me', humanName: 'Rae', seats })
  // Force a known rack + empty board so we can place CAT across the centre.
  s = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, rack: ['C', 'A', 'T', 'X', 'Y', 'Z', 'B'] } : p)) }
  const placements = [
    { row: 7, col: 6, letter: 'C', isBlank: false },
    { row: 7, col: 7, letter: 'A', isBlank: false },
    { row: 7, col: 8, letter: 'T', isBlank: false },
  ]
  const after = applyPlay(s, placements)
  assert.ok(after.players[0].score > 0, 'human scored')
  assert.equal(after.players[0].rack.length, 7, 'rack refilled to 7')
  assert.equal(after.currentPlayerIdx, 1, 'turn advanced to the bot')
  assert.equal(after.consecutivePasses, 0)
  assert.ok(after.board[7][7], 'tile committed to the board')
  assert.deepEqual(after.lastMoveTiles, [{ row: 7, col: 6 }, { row: 7, col: 7 }, { row: 7, col: 8 }])
})

test('applyPass: advances turn; enough passes ends the game', () => {
  let s = initSoloGame({ humanId: 'me', humanName: 'Rae', seats })
  s = applyPass(s) // human passes → bot
  assert.equal(s.currentPlayerIdx, 1)
  assert.equal(s.consecutivePasses, 1)
  s = applyPass(s) // bot passes
  s = applyPass(s)
  s = applyPass(s) // 2 players × 2 = 4 passes → over
  assert.equal(s.status, 'finished')
  assert.ok(s.players.some(p => p.is_winner))
})

test('applyExchange: swaps tiles, keeps rack at 7, counts as a pass', () => {
  let s = initSoloGame({ humanId: 'me', humanName: 'Rae', seats })
  const before = s.players[0].rack.length
  const after = applyExchange(s, [0, 1])
  assert.equal(after.players[0].rack.length, before, 'rack stays full after a swap')
  assert.equal(after.consecutivePasses, 1)
  assert.equal(after.currentPlayerIdx, 1)
  assert.equal(after.tileBag.length, s.tileBag.length, 'bag size unchanged (2 out, 2 in)')
})

test('botDecide + applyBotAction: bot makes a legal opening play', () => {
  const text = readFileSync(new URL('../../public/words.txt', import.meta.url), 'utf8')
  const dict = buildDictionary(text.split('\n'))

  let s = initSoloGame({ humanId: 'me', humanName: 'Rae', seats })
  // Give the bot a friendly rack and make it the bot's turn.
  s = {
    ...s,
    currentPlayerIdx: 1,
    players: s.players.map((p, i) => (i === 1 ? { ...p, rack: ['C', 'A', 'T', 'E', 'R', 'S', 'O'] } : p)),
  }
  const action = botDecide(s, dict, { rng: () => 0.99 })
  assert.equal(action.type, 'play', 'bot finds a play from a rich rack')
  const after = applyBotAction(s, action)
  assert.ok(after.players[1].score > 0, 'bot scored')
  assert.equal(after.currentPlayerIdx, 0, 'turn returns to the human')
  assert.equal(after.players[1].rack.length, 7, 'bot rack refilled')
})

test('a few full turns run without corruption', () => {
  const text = readFileSync(new URL('../../public/words.txt', import.meta.url), 'utf8')
  const dict = buildDictionary(text.split('\n'))
  let s = initSoloGame({ humanId: 'me', humanName: 'Rae', seats })

  // Human opens with a guaranteed word, then let the bot respond a few times.
  s = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, rack: ['C', 'A', 'T', 'S', 'E', 'R', 'O'] } : p)) }
  s = applyPlay(s, [
    { row: 7, col: 7, letter: 'C', isBlank: false },
    { row: 7, col: 8, letter: 'A', isBlank: false },
    { row: 7, col: 9, letter: 'T', isBlank: false },
  ])

  for (let turn = 0; turn < 4 && s.status === 'active'; turn++) {
    const cur = s.players[s.currentPlayerIdx]
    if (cur.isBot) {
      s = applyBotAction(s, botDecide(s, dict, { rng: () => 0.5 }))
    } else {
      s = applyPass(s) // human just passes in this smoke test
    }
    // invariants
    assert.ok(s.players.every(p => p.rack.length <= 7))
    assert.ok(s.currentPlayerIdx >= 0 && s.currentPlayerIdx < s.players.length)
  }
  assert.ok(true, 'no crash across several turns')
})
