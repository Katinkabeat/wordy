// Supabase Edge Function: Push-Notification
// Handles three notification types:
//   1. turn_change  — DB webhook fires when games.current_player_idx changes
//   2. player_joined — client POST when someone joins a game
//   3. nudge         — client POST to remind an inactive player it's their turn
//
// Uses the battle-tested `web-push` npm library via Deno's npm: specifier
// to handle all the VAPID signing + payload encryption correctly.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const VAPID_PRIVATE_KEY    = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_PUBLIC_KEY     = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_SUBJECT        = Deno.env.get('VAPID_SUBJECT')!
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

// CORS headers for browser-initiated requests (player_joined, nudge)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Helper: send a push notification to a user, cleaning up expired subs
async function sendPushToUser(
  supabase: any,
  userId: string,
  payload: { title: string; body: string; tag: string; url: string }
): Promise<{ sent: boolean; reason?: string }> {
  const { data: sub, error: subErr } = await supabase
    .from('push_subscriptions')
    .select('endpoint, keys_p256dh, keys_auth')
    .eq('user_id', userId)
    .eq('app', 'wordy')
    .single()

  if (subErr || !sub) return { sent: false, reason: 'no push subscription' }

  const pushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
  }

  try {
    await webpush.sendNotification(pushSubscription, JSON.stringify(payload), { TTL: 86400 })
    return { sent: true }
  } catch (pushErr: any) {
    if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
      await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('app', 'wordy')
      return { sent: false, reason: 'expired subscription removed' }
    }
    throw pushErr
  }
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // ── Type: player_joined (from client) ───────────────────────
    if (payload.type === 'player_joined') {
      const { game_id, joiner_name } = payload

      const { data: game } = await supabase
        .from('games')
        .select('created_by')
        .eq('id', game_id)
        .single()

      if (!game?.created_by) {
        return new Response(JSON.stringify({ skipped: 'no creator' }), { status: 200, headers: corsHeaders })
      }

      const result = await sendPushToUser(supabase, game.created_by, {
        title: 'Wordy — Player joined!',
        body: `${joiner_name || 'Someone'} joined your game! 🎉`,
        tag: `wordy-join-${game_id}`,
        url: `/wordy/game/${game_id}`,
      })

      return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
    }

    // ── Type: nudge (from client) ───────────────────────────────
    if (payload.type === 'nudge') {
      const { game_id, nudger_name } = payload

      // Look up the game to find current player
      const { data: game } = await supabase
        .from('games')
        .select('current_player_idx, status')
        .eq('id', game_id)
        .single()

      if (!game || game.status !== 'active') {
        return new Response(JSON.stringify({ skipped: 'game not active' }), { status: 200, headers: corsHeaders })
      }

      // Find the user whose turn it is
      const { data: currentPlayer } = await supabase
        .from('game_players')
        .select('user_id')
        .eq('game_id', game_id)
        .eq('player_index', game.current_player_idx)
        .single()

      if (!currentPlayer) {
        return new Response(JSON.stringify({ skipped: 'player not found' }), { status: 200, headers: corsHeaders })
      }

      const result = await sendPushToUser(supabase, currentPlayer.user_id, {
        title: "Wordy — It's your turn!",
        body: `${nudger_name || 'Someone'} is waiting for your move! 🔔`,
        tag: `wordy-nudge-${game_id}`,
        url: `/wordy/game/${game_id}`,
      })

      return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
    }

    // ── Type: turn_change (from DB webhook) ─────────────────────
    const { record, old_record } = payload

    if (!record || record.status !== 'active') {
      return new Response(JSON.stringify({ skipped: 'game not active' }), { status: 200, headers: corsHeaders })
    }
    if (old_record && record.current_player_idx === old_record.current_player_idx) {
      return new Response(JSON.stringify({ skipped: 'turn did not change' }), { status: 200, headers: corsHeaders })
    }

    const gameId           = record.id
    const currentPlayerIdx = record.current_player_idx

    // Find the player whose turn it is
    const { data: currentPlayer, error: playerErr } = await supabase
      .from('game_players')
      .select('user_id')
      .eq('game_id', gameId)
      .eq('player_index', currentPlayerIdx)
      .single()

    if (playerErr || !currentPlayer) {
      return new Response(JSON.stringify({ skipped: 'player not found' }), { status: 200, headers: corsHeaders })
    }

    // Get the username of the player who just moved
    let moverName = 'Your opponent'
    if (old_record) {
      const { data: mover } = await supabase
        .from('game_players')
        .select('user_id')
        .eq('game_id', gameId)
        .eq('player_index', old_record.current_player_idx)
        .single()

      if (mover) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', mover.user_id)
          .single()
        if (profile) moverName = profile.username
      }
    }

    const result = await sendPushToUser(supabase, currentPlayer.user_id, {
      title: "Wordy — It's your turn!",
      body: `${moverName} just played. Your move! 🟣`,
      tag: `wordy-turn-${gameId}`,
      url: `/wordy/game/${gameId}`,
    })

    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
  } catch (err: any) {
    console.error('Push notification error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
