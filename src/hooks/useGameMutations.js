import { useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase.js'
import { refillRack } from '../lib/tileData.js'
import { serializeBoard } from '../lib/boardData.js'
import {
  validatePlacement, extractWords, calculateScore,
  isGameOver, finalizeEndgame,
} from '../lib/gameLogic.js'
import { validateWords } from '../lib/wordValidator.js'

// Records final winner / scores / leaderboard stats. Called unawaited from the
// move flow — the game-finished status is already set atomically inside
// submit_play, so the game itself is never stuck on this. But it is NOT
// fire-and-forget internally: a stale-token 401 after a backgrounded mobile tab
// would otherwise silently drop the win flag + the leaderboard (player_matchups)
// stamp while the game still shows finished. So we refreshSession() and retry
// until it lands. Errors are logged, never thrown.
async function callFinishGameRpc(gameId, finalPlayers) {
  const p_player_results = finalPlayers.map(fp => ({
    user_id:   fp.user_id,
    score:     fp.score,
    is_winner: fp.is_winner ?? false,
  }))
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await supabase.rpc('finish_game', { p_game_id: gameId, p_player_results })
    if (!error) return
    console.error(`finish_game RPC failed (attempt ${attempt + 1}):`, error)
    await supabase.auth.refreshSession().catch(() => {})
    await new Promise(r => setTimeout(r, 400 * (attempt + 1)))
  }
}

export function useGameMutations({
  game, players, myPlayer,
  board,
  placements, setPlacements,
  exchangeSel, setExchange, setExchangeSel,
  setForfeitModal,
  gameId, user,
  loadGame,
  mutatingRef,
  isFirstMove, isMyTurn,
  recall,
}) {
  const [submitting, setSubmitting] = useState(false)

  async function submitWord() {
    if (submitting || placements.length === 0) return
    if (game.status !== 'active') return   // guard against post-forfeit submissions
    setSubmitting(true)

    try {
      // ── Validation phase ──────────────────────────────────
      // No mutation guard here — if validation fails, local state is correct
      // (tiles on board, removed from rack, tracked by placements).
      const validation = validatePlacement(board, placements, isFirstMove)
      if (!validation.valid) { toast.error(validation.error); return }

      const words = extractWords(board, placements)
      if (words.length === 0) { toast.error('No valid words formed.'); return }

      const { allValid, invalidWords } = await validateWords(words.map(w => w.word))
      if (!allValid) {
        toast.error(`Not valid words: ${invalidWords.join(', ')}`)
        return
      }

      const turnScore  = calculateScore(board, placements, words, game.board_layout_version ?? 1)
      const newScore   = (myPlayer.score ?? 0) + turnScore
      const newBoardFlat = serializeBoard(board)

      let { rack: newRack, bag: newBag } = refillRack(myPlayer.rack, [...(game.tile_bag)])

      // Advance turn
      const nextIdx = (myPlayer.player_index + 1) % players.length

      // Check game over
      const over = isGameOver(newBag.length, newRack, 0, players.length)

      // If game over, apply end-game penalties (this player emptied their rack
      // so they get the bonus; the others lose their rack values).
      let finalPlayers = players.map(p =>
        p.user_id === user.id ? { ...p, score: newScore, rack: newRack } : p
      )
      if (over) finalPlayers = finalizeEndgame(finalPlayers, user.id)

      // ── DB write phase ────────────────────────────────────
      // Suppress real-time reloads while the write is in progress.
      mutatingRef.current = true
      try {
        // Atomic: a SECURITY DEFINER RPC writes games + game_players in one
        // transaction so a play is all-or-nothing. A split client-side write
        // (RLS forces game_players to be a separate UPDATE) could half-commit
        // and corrupt the game — score/rack saved but board/turn lost.
        const { error: playErr } = await supabase.rpc('submit_play', {
          p_game_id: gameId,
          p_user_id: user.id,
          p_board: newBoardFlat,
          p_tile_bag: newBag,
          p_rack: newRack,
          p_score: newScore,
          p_current_player_idx: nextIdx,
          p_is_game_over: over,
        })
        if (playErr) { console.error('submit_play RPC failed:', playErr); toast.error('Failed to save move — please retry.'); recall(); return }

        // Fire-and-forget: move log + finish RPC are non-critical for gameplay
        if (over) callFinishGameRpc(gameId, finalPlayers)

        supabase.from('game_moves').insert({
          game_id: gameId, user_id: user.id,
          move_type: 'place',
          tiles_placed: placements,
          words_formed: words.map(w => w.word),
          score: turnScore,
          rack_after: newRack,
        }).then(({ error }) => { if (error) console.error('game_moves insert failed:', error) })

        setPlacements([])
        toast.success(`+${turnScore} pts ✨  [${words.map(w => w.word).join(', ')}]`)
        if (over) toast('🏆 Game over!')
      } finally {
        mutatingRef.current = false
        // Reload from DB now that critical writes have completed
        loadGame({ force: true })
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function passTurn() {
    if (!isMyTurn()) return
    recall()
    mutatingRef.current = true

    try {
      // Atomic + authoritative: the RPC increments the pass counter, advances
      // the turn, and decides game-over SERVER-side — pass-out only ends the
      // game when the tile bag is empty (c289), so a client can't force an
      // early finish. Returns whether the game ended.
      const { data: over, error: passErr } = await supabase.rpc('submit_pass', {
        p_game_id: gameId,
        p_user_id: user.id,
      })
      if (passErr) { console.error('submit_pass RPC failed:', passErr); toast.error('Failed to pass — please retry.'); return }

      // Fire-and-forget: move log + finish RPC are non-critical
      supabase.from('game_moves').insert({
        game_id: gameId, user_id: user.id,
        move_type: 'pass', score: 0, rack_after: myPlayer.rack,
      }).then(({ error }) => { if (error) console.error('pass: game_moves insert failed:', error) })

      if (over) {
        // Game over via passes: everyone loses their rack value (no one gets the bonus)
        callFinishGameRpc(gameId, finalizeEndgame([...players], null))
        toast('🏆 Game over — no moves left!')
      } else {
        toast('⏩ Turn passed.')
      }
    } finally {
      mutatingRef.current = false
      loadGame({ force: true })
    }
  }

  async function confirmExchange() {
    if (exchangeSel.length === 0) { toast.error('Select tiles to exchange.'); return }
    if ((game.tile_bag?.length ?? 0) < exchangeSel.length) {
      toast.error('Not enough tiles in the bag to exchange.')
      return
    }
    mutatingRef.current = true

    try {
      const newRack   = [...myPlayer.rack]
      const returned  = exchangeSel.map(i => newRack[i])
      const remaining = newRack.filter((_, i) => !exchangeSel.includes(i))
      let   bag       = [...(game.tile_bag)]

      let { rack: refilled, bag: newBag } = refillRack(remaining, bag)
      newBag = [...newBag, ...returned]

      const nextIdx   = (myPlayer.player_index + 1) % players.length
      const newPasses = (game.consecutive_passes ?? 0) + 1
      // Pass-out only ends the game when the bag is empty (c289) — and an
      // exchange puts tiles back in the bag, so `over` is effectively always
      // false here. Kept as the real rule (server recomputes it anyway) so
      // this stays in sync with submit_exchange / isGameOver.
      const over      = newPasses >= players.length * 2 && newBag.length === 0

      let finalPlayers = [...players]
      if (over) finalPlayers = finalizeEndgame(finalPlayers, null)

      // Atomic: one transaction for games + game_players (see submit_play note).
      const { error: exchErr } = await supabase.rpc('submit_exchange', {
        p_game_id: gameId,
        p_user_id: user.id,
        p_tile_bag: newBag,
        p_rack: refilled,
        p_current_player_idx: nextIdx,
        p_consecutive_passes: newPasses,
        p_is_game_over: over,
      })
      if (exchErr) { console.error('submit_exchange RPC failed:', exchErr); toast.error('Failed to exchange — please retry.'); return }

      // Fire-and-forget: move log + finish RPC are non-critical
      supabase.from('game_moves').insert({
        game_id: gameId, user_id: user.id,
        move_type: 'exchange', score: 0, rack_after: refilled,
      }).then(({ error }) => { if (error) console.error('exchange: game_moves insert failed:', error) })

      if (over) {
        callFinishGameRpc(gameId, finalPlayers)
        toast('🏆 Game over — no moves left!')
      } else {
        toast('🔄 Tiles exchanged!')
      }

      setExchange(false)
      setExchangeSel([])
    } finally {
      mutatingRef.current = false
      loadGame({ force: true })
    }
  }

  async function forfeitGame() {
    // Uses a SECURITY DEFINER function so it can update all players' rows
    // regardless of RLS (which would otherwise block updating opponents' rows)
    await supabase.rpc('forfeit_game', {
      p_game_id: gameId,
      p_forfeit_user_id: user.id,
    })
    // Reload immediately so profiles/players are fresh before the banner renders
    await loadGame()
    setForfeitModal(false)
  }

  return { submitting, submitWord, passTurn, confirmExchange, forfeitGame }
}
