// ────────────────────────────────────────────────────────────
//  bot-move edge function (card c162)
//
//  Fired by the on_bot_turn trigger when a game's current player is a
//  computer player. Reads the game, picks a move with the SHARED engine
//  + that character's difficulty profile, and submits it via the same
//  RPCs a human uses (submit_play / submit_exchange) with the service-
//  role key (which the c157 guard exempts).
//
//  Imports the pure engine/game-logic straight from ../../../src/lib —
//  single source of truth, no vendored copy. If `supabase functions
//  deploy` can't bundle files outside the functions dir, vendor those
//  modules into a _shared/ folder and update these import paths.
//
//  Wordlist: fetched once from the deployed words.txt (WORDY_WORDS_URL)
//  and cached for the life of the (warm) instance. The DAWG-minimization
//  follow-up (c160) matters most here for cold-start cost.
// ────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import { buildDictionary, generateMoves, chooseMoveFor } from '../../../src/lib/engine/index.js'
import { deserializeBoard, serializeBoard } from '../../../src/lib/boardData.js'
import { extractWords, calculateScore, isGameOver, finalizeEndgame } from '../../../src/lib/gameLogic.js'
import { refillRack } from '../../../src/lib/tileData.js'
import { CHARACTER_BY_BOT_ID } from '../../../src/lib/botAccounts.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WORDS_URL = Deno.env.get('WORDY_WORDS_URL') ?? 'https://katinkabeat.github.io/wordy/words.txt'

let dictPromise: Promise<any> | null = null
function getDict() {
  if (!dictPromise) {
    dictPromise = fetch(WORDS_URL)
      .then(r => r.text())
      .then(t => buildDictionary(t.split('\n')))
  }
  return dictPromise
}

// Always 200 so a failure never makes pg_net retry-loop the trigger.
const done = (msg: string) => new Response(JSON.stringify({ ok: true, msg }), { status: 200 })

serve(async (req) => {
  try {
    const { record: game } = await req.json()
    if (!game || game.status !== 'active') return done('game not active')

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

    const { data: players, error: pErr } = await supabase
      .from('game_players')
      .select('user_id, player_index, rack, score')
      .eq('game_id', game.id)
      .order('player_index')
    if (pErr) throw pErr

    const me = (players ?? []).find((p: any) => p.player_index === game.current_player_idx)
    if (!me) return done('no current player')

    const characterId = CHARACTER_BY_BOT_ID[me.user_id]
    if (!characterId) return done('current player is not a bot')

    const layoutVersion = game.board_layout_version ?? 1
    const nextIdx = (me.player_index + 1) % players.length

    const board = deserializeBoard(game.board)
    const dict = await getDict()
    const moves = generateMoves(board, me.rack, dict, { layoutVersion })
    const choice = chooseMoveFor(moves, characterId)

    // Human-ish "thinking" pause (~3–5s) so the bot's move doesn't pop in
    // instantly. Applies to play / exchange / pass alike.
    await new Promise((r) => setTimeout(r, 3000 + Math.random() * 2000))

    // ── A play ────────────────────────────────────────────────
    if (choice) {
      const b = board.map((row: any[]) => row.slice())
      for (const p of choice.placements) {
        b[p.row][p.col] = { letter: p.letter, isBlank: !!p.isBlank, uid: me.user_id }
      }
      const words = extractWords(b, choice.placements)
      const turnScore = calculateScore(b, choice.placements, words, layoutVersion)

      const rack = [...me.rack]
      for (const p of choice.placements) {
        const tile = p.isBlank ? '?' : p.letter
        const i = rack.indexOf(tile)
        if (i !== -1) rack.splice(i, 1)
      }
      const { rack: newRack, bag: newBag } = refillRack(rack, [...game.tile_bag])
      const over = isGameOver(newBag.length, newRack, 0, players.length)

      let finalPlayers = players.map((p: any) =>
        p.user_id === me.user_id ? { ...p, score: (me.score ?? 0) + turnScore, rack: newRack } : { ...p })
      if (over) finalPlayers = finalizeEndgame(finalPlayers, me.user_id)

      const { error } = await supabase.rpc('submit_play', {
        p_game_id: game.id, p_user_id: me.user_id,
        p_board: serializeBoard(b), p_tile_bag: newBag, p_rack: newRack,
        p_score: (me.score ?? 0) + turnScore, p_current_player_idx: nextIdx, p_is_game_over: over,
      })
      if (error) throw error

      await supabase.from('game_moves').insert({
        game_id: game.id, user_id: me.user_id, move_type: 'place',
        tiles_placed: choice.placements, words_formed: words.map((w: any) => w.word),
        score: turnScore, rack_after: newRack,
      })
      if (over) {
        await supabase.rpc('finish_game', {
          p_game_id: game.id,
          p_player_results: finalPlayers.map((fp: any) => ({ user_id: fp.user_id, score: fp.score, is_winner: fp.is_winner ?? false })),
        })
      }
      return done(`played ${words.map((w: any) => w.word).join(',')} (+${turnScore})`)
    }

    // ── No play: exchange if the bag allows, else pass ────────
    // Pass-out only ends the game when the bag is empty (c289). An exchange
    // returns tiles to the bag, so it can never be the game-ending move; a
    // pass goes through submit_pass, which decides game-over server-side.
    let over = false

    if (game.tile_bag.length >= 1) {
      const newPasses = (game.consecutive_passes ?? 0) + 1
      const n = Math.min(me.rack.length, game.tile_bag.length)
      const returned = me.rack.slice(0, n)
      const remaining = me.rack.slice(n)
      const { rack: refilled, bag } = refillRack(remaining, [...game.tile_bag])
      const newBag = [...bag, ...returned]

      const { error } = await supabase.rpc('submit_exchange', {
        p_game_id: game.id, p_user_id: me.user_id, p_tile_bag: newBag, p_rack: refilled,
        p_current_player_idx: nextIdx, p_consecutive_passes: newPasses, p_is_game_over: false,
      })
      if (error) throw error
      await supabase.from('game_moves').insert({ game_id: game.id, user_id: me.user_id, move_type: 'exchange', score: 0, rack_after: refilled })
    } else {
      // Same atomic RPC humans use (the c157 guard exempts service_role);
      // also bumps last_activity_at, which the old direct UPDATE skipped.
      const { data, error } = await supabase.rpc('submit_pass', {
        p_game_id: game.id, p_user_id: me.user_id,
      })
      if (error) throw error
      over = data === true
      await supabase.from('game_moves').insert({ game_id: game.id, user_id: me.user_id, move_type: 'pass', score: 0, rack_after: me.rack })
    }

    let finalPlayers = players.map((p: any) => ({ ...p }))
    if (over) finalPlayers = finalizeEndgame(finalPlayers, null)

    if (over) {
      await supabase.rpc('finish_game', {
        p_game_id: game.id,
        p_player_results: finalPlayers.map((fp: any) => ({ user_id: fp.user_id, score: fp.score, is_winner: fp.is_winner ?? false })),
      })
    }
    return done(game.tile_bag.length >= 1 ? 'exchanged' : 'passed')
  } catch (e) {
    console.error('bot-move error:', e)
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 200 })
  }
})
