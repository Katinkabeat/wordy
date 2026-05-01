import { supabase } from './supabase.js'
import { createTileBag, refillRack } from './tileData.js'
import { createEmptyBoard, serializeBoard } from './boardData.js'

// Pure data ops for the lobby. UI concerns (toast, navigate, button-state)
// stay in the caller — these throw on failure and return the new game id.

export async function createGame({ user, maxPlayers }) {
  let bag  = createTileBag()
  let rack = []
  ;({ rack, bag } = refillRack(rack, bag))

  const board = serializeBoard(createEmptyBoard())

  const { data: game, error: gameErr } = await supabase
    .from('games')
    .insert({ status: 'waiting', max_players: maxPlayers, tile_bag: bag, board, created_by: user.id })
    .select().single()
  if (gameErr) throw gameErr

  const { error: playerErr } = await supabase
    .from('game_players')
    .insert({ game_id: game.id, user_id: user.id, player_index: 0, rack })
  if (playerErr) throw playerErr

  return { gameId: game.id }
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

  // Notify the game creator that someone joined (fire-and-forget)
  fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/Push-Notification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ type: 'player_joined', game_id: game.id, joiner_name: joinerName }),
  })
    .then(r => r.json().then(d => console.log('[push-notify]', r.status, d)))
    .catch(e => console.warn('[push-notify] failed:', e))

  return { gameId: game.id, alreadyIn: false }
}
