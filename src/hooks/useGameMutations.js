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

// Spread into a `games` UPDATE payload to flip status when the game ends.
function endgameFields(over) {
  return over ? { status: 'finished', finished_at: new Date().toISOString() } : {}
}

// Fire-and-forget finish_game RPC. Errors are logged, never thrown — the
// move itself succeeded; the RPC just stamps winner/score history.
function callFinishGameRpc(gameId, finalPlayers) {
  return supabase.rpc('finish_game', {
    p_game_id: gameId,
    p_player_results: finalPlayers.map(fp => ({
      user_id:   fp.user_id,
      score:     fp.score,
      is_winner: fp.is_winner ?? false,
    })),
  }).then(({ error }) => { if (error) console.error('finish_game RPC failed:', error) })
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
      // Suppress real-time reloads while parallel writes are in progress.
      mutatingRef.current = true
      try {
        // Run game + player updates in parallel (independent tables)
        const [{ error: gameErr }, { error: playerErr }] = await Promise.all([
          supabase.from('games').update({
            board: newBoardFlat,
            tile_bag: newBag,
            current_player_idx: nextIdx,
            consecutive_passes: 0,
            ...endgameFields(over),
          }).eq('id', gameId),
          supabase.from('game_players').update({
            score: newScore,
            rack:  newRack,
          }).eq('game_id', gameId).eq('user_id', user.id),
        ])
        if (gameErr) { console.error('games update failed:', gameErr); toast.error('Failed to save move — please retry.'); recall(); return }
        if (playerErr) { console.error('game_players update failed:', playerErr); toast.error('Failed to save rack — please retry.'); recall(); return }

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
    const nextIdx   = (myPlayer.player_index + 1) % players.length
    const newPasses = (game.consecutive_passes ?? 0) + 1
    const over      = newPasses >= players.length * 2

    // If game over via passes: everyone loses their rack value (no one gets the bonus)
    let finalPlayers = [...players]
    if (over) finalPlayers = finalizeEndgame(finalPlayers, null)

    try {
      const { error: gameErr } = await supabase.from('games').update({
        current_player_idx: nextIdx,
        consecutive_passes: newPasses,
        ...endgameFields(over),
      }).eq('id', gameId)
      if (gameErr) { console.error('pass: games update failed:', gameErr); toast.error('Failed to pass — please retry.'); return }

      // Fire-and-forget: move log + finish RPC are non-critical
      supabase.from('game_moves').insert({
        game_id: gameId, user_id: user.id,
        move_type: 'pass', score: 0, rack_after: myPlayer.rack,
      }).then(({ error }) => { if (error) console.error('pass: game_moves insert failed:', error) })

      if (over) {
        callFinishGameRpc(gameId, finalPlayers)
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
      const over      = newPasses >= players.length * 2

      let finalPlayers = [...players]
      if (over) finalPlayers = finalizeEndgame(finalPlayers, null)

      // Run game + player updates in parallel (independent tables)
      const [{ error: gameErr }, { error: playerErr }] = await Promise.all([
        supabase.from('games').update({
          tile_bag: newBag,
          current_player_idx: nextIdx,
          consecutive_passes: newPasses,
          ...endgameFields(over),
        }).eq('id', gameId),
        supabase.from('game_players').update({ rack: refilled })
          .eq('game_id', gameId).eq('user_id', user.id),
      ])
      if (gameErr) { console.error('exchange: games update failed:', gameErr); toast.error('Failed to exchange — please retry.'); return }
      if (playerErr) { console.error('exchange: game_players update failed:', playerErr); toast.error('Failed to save rack — please retry.'); return }

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
