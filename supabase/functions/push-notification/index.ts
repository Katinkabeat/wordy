// Supabase Edge Function: push-notification
// Handles two event types:
//   1. Turn change (triggered by database webhook when games.current_player_idx changes)
//   2. Player joined (triggered by client when someone joins a waiting game)
//
// Uses the battle-tested `web-push` npm library via Deno's npm: specifier
// to handle all the VAPID signing + payload encryption correctly.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

// Set as Edge Function secrets:
//   supabase secrets set VAPID_PRIVATE_KEY="..."
//   supabase secrets set VAPID_PUBLIC_KEY="..."
//   supabase secrets set VAPID_SUBJECT="mailto:you@example.com"
const VAPID_PRIVATE_KEY    = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_PUBLIC_KEY     = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_SUBJECT        = Deno.env.get('VAPID_SUBJECT')!
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

/** Helper: send a push notification and clean up expired subscriptions */
async function sendPush(
  supabase: any,
  targetUserId: string,
  pushPayload: string,
) {
  const { data: sub, error: subErr } = await supabase
    .from('push_subscriptions')
    .select('endpoint, keys_p256dh, keys_auth')
    .eq('user_id', targetUserId)
    .single()

  if (subErr || !sub) {
    return { skipped: 'no push subscription' }
  }

  const pushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
  }

  try {
    await webpush.sendNotification(pushSubscription, pushPayload, { TTL: 86400 })
    return { sent: true }
  } catch (pushErr: any) {
    if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
      await supabase.from('push_subscriptions').delete().eq('user_id', targetUserId)
      return { cleaned: 'expired subscription removed' }
    }
    throw pushErr
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // ── Player joined notification (called from client) ──────────
    if (payload.type === 'player_joined') {
      const { game_id, joiner_name } = payload
      if (!game_id) {
        return new Response(JSON.stringify({ skipped: 'missing game_id' }), { status: 200, headers: corsHeaders })
      }

      // Find the game creator
      const { data: game, error: gameErr } = await supabase
        .from('games')
        .select('created_by')
        .eq('id', game_id)
        .single()

      if (gameErr || !game) {
        return new Response(JSON.stringify({ skipped: 'game not found' }), { status: 200, headers: corsHeaders })
      }

      const pushPayload = JSON.stringify({
        title: 'Wordy — Player joined!',
        body: `${joiner_name || 'Someone'} joined your game! 🟣`,
        tag: `wordy-join-${game_id}`,
        url: `/wordy/game/${game_id}`,
      })

      const result = await sendPush(supabase, game.created_by, pushPayload)
      return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
    }

    // ── Turn change notification (called from database webhook) ──
    const { record, old_record } = payload

    // Only proceed if:
    //  1. The game is active (not finished/waiting)
    //  2. The current_player_idx actually changed (a turn happened)
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

    const targetUserId = currentPlayer.user_id

    // Get the username of the player who just moved (for the notification body)
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

    // Build the push notification payload
    const pushPayload = JSON.stringify({
      title: "Wordy — It's your turn!",
      body: `${moverName} just played. Your move! 🟣`,
      tag: `wordy-turn-${gameId}`,
      url: `/wordy/game/${gameId}`,
    })

    const result = await sendPush(supabase, targetUserId, pushPayload)
    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
  } catch (err: any) {
    console.error('Push notification error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
