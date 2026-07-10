import { supabase } from './supabase.js'
import { createTileBag, refillRack } from './tileData.js'
import { createEmptyBoard, serializeBoard, CURRENT_LAYOUT_VERSION } from './boardData.js'
// Direct utils import (not sq-ui's index) so this non-React lib file doesn't
// pull the package's JSX components into its chunk.
import { firePushAndReport } from '../../../rae-side-quest/packages/sq-ui/utils/report.js'

// Pure data ops for the lobby. UI concerns (toast, navigate, button-state)
// stay in the caller — these throw on failure and return the new game id.

/**
 * Create a new game. Pass `invitedUserIds` (uuid[]) to invite specific
 * friends. Up to `maxPlayers - 1` invitees allowed. Their slots are
 * reserved (randos can only fill unreserved slots). Auto-cancels in
 * 24h if invited; 7d if open. expires_at is filled by the
 * wordy_set_game_expiry trigger — we don't pass it.
 */
export async function createGame({ user, maxPlayers, invitedUserIds = [] }) {
  let bag  = createTileBag()
  let rack = []
  ;({ rack, bag } = refillRack(rack, bag))

  const board = serializeBoard(createEmptyBoard())

  const insertRow = {
    status: 'waiting',
    max_players: maxPlayers,
    tile_bag: bag,
    board,
    created_by: user.id,
    board_layout_version: CURRENT_LAYOUT_VERSION,
  }
  if (invitedUserIds && invitedUserIds.length > 0) {
    insertRow.invited_user_ids = invitedUserIds
  }

  const { data: game, error: gameErr } = await supabase
    .from('games')
    .insert(insertRow)
    .select().single()
  if (gameErr) throw gameErr

  const { error: playerErr } = await supabase
    .from('game_players')
    .insert({ game_id: game.id, user_id: user.id, player_index: 0, rack })
  if (playerErr) throw playerErr

  return { gameId: game.id }
}

/**
 * Cancel a game the current user created. Server enforces:
 *   - caller is the creator
 *   - status is 'waiting' or 'active'
 *   - no game_moves exist
 */
export async function cancelGame(gameId) {
  const { error } = await supabase.rpc('wordy_cancel_game', { p_game_id: gameId })
  if (error) throw error
}

/**
 * Decline an invite to a waiting game. Server enforces:
 *   - caller is a pending invitee of a 'waiting' game
 *   - caller hasn't already joined
 * Removes the caller from invited_user_ids; if that strands the game
 * (only the creator left, no other pending invitees) it's closed with
 * close_reason = 'Invite declined'.
 */
export async function declineInvite(gameId) {
  const { error } = await supabase.rpc('wordy_decline_invite', { p_game_id: gameId })
  if (error) throw error
}

/**
 * Claim the win on a game stalled on an inactive opponent (c153). Server
 * enforces: caller is a participant, it's NOT the caller's turn, and the
 * current player has been idle 7+ days (games.last_activity_at). The stalled
 * player is forfeited; the caller wins.
 */
export async function claimInactiveWin(gameId) {
  const { error } = await supabase.rpc('claim_inactive_win', { p_game_id: gameId })
  if (error) throw error
}

/**
 * Sweeps any waiting games past expires_at:
 *   - 2+ players joined → auto-start
 *   - <2 joined        → auto-cancel
 * Safe to call from anywhere; only acts on stale rows.
 */
export async function autoStartOrCancelStale() {
  const { error } = await supabase.rpc('wordy_auto_start_or_cancel_stale')
  if (error) throw error
}

export async function joinGame({ user, game, joinerName }) {
  const alreadyIn = game.game_players.some(p => p.user_id === user.id)
  if (alreadyIn) return { gameId: game.id, alreadyIn: true }

  const playerIndex = game.game_players.length
  if (playerIndex >= game.max_players) {
    const err = new Error('This game is full!')
    err.code = 'GAME_FULL'
    throw err
  }

  const { data: fresh } = await supabase
    .from('games').select('tile_bag').eq('id', game.id).single()
  let bag  = fresh.tile_bag
  let rack = []
  ;({ rack, bag } = refillRack(rack, bag))

  const { error: joinErr } = await supabase
    .from('game_players')
    .insert({ game_id: game.id, user_id: user.id, player_index: playerIndex, rack })
  if (joinErr) throw joinErr

  await supabase.from('games').update({ tile_bag: bag }).eq('id', game.id)

  if (playerIndex + 1 === game.max_players) {
    const randomFirst = Math.floor(Math.random() * game.max_players)
    await supabase.from('games').update({ status: 'active', current_player_idx: randomFirst }).eq('id', game.id)
  }

  // Notify the game creator that someone joined. This is a side effect of a join
  // that already succeeded, so we never block the joiner or toast on failure —
  // but a swallowed push failure is reported to #error-log (c262/c265) so a broken
  // push can't hide the way player_joined's 404 did for months (c260). A 200 with
  // { sent:false } (creator opted out / no subscription) is a normal outcome, not
  // a failure, and is left silent.
  void firePushAndReport({
    pushUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/push-notification`,
    reportUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sq-report-client-error`,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    body: { type: 'player_joined', game_id: game.id, joiner_name: joinerName },
    game: 'wordy', type: 'player_joined', detail: `game_id=${game.id}`,
  })

  return { gameId: game.id, alreadyIn: false }
}
