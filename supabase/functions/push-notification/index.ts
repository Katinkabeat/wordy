// Supabase Edge Function: push-notification
// Triggered by a database webhook when games.current_player_idx changes.
// Sends a Web Push notification to the player whose turn it now is.
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

serve(async (req: Request) => {
  try {
    const payload = await req.json()

    // The webhook sends the full row as `record` and previous as `old_record`
    const { record, old_record } = payload

    // Only proceed if:
    //  1. The game is active (not finished/waiting)
    //  2. The current_player_idx actually changed (a turn happened)
    if (!record || record.status !== 'active') {
      return new Response(JSON.stringify({ skipped: 'game not active' }), { status: 200 })
    }
    if (old_record && record.current_player_idx === old_record.current_player_idx) {
      return new Response(JSON.stringify({ skipped: 'turn did not change' }), { status: 200 })
    }

    const gameId           = record.id
    const currentPlayerIdx = record.current_player_idx

    // Use the service role key to bypass RLS
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Find the player whose turn it is
    const { data: currentPlayer, error: playerErr } = await supabase
      .from('game_players')
      .select('user_id')
      .eq('game_id', gameId)
      .eq('player_index', currentPlayerIdx)
      .single()

    if (playerErr || !currentPlayer) {
      return new Response(JSON.stringify({ skipped: 'player not found' }), { status: 200 })
    }

    const targetUserId = currentPlayer.user_id

    // Get their push subscription
    const { data: sub, error: subErr } = await supabase
      .from('push_subscriptions')
      .select('endpoint, keys_p256dh, keys_auth')
      .eq('user_id', targetUserId)
      .single()

    if (subErr || !sub) {
      return new Response(JSON.stringify({ skipped: 'no push subscription' }), { status: 200 })
    }

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

    // Send via web-push library (handles VAPID + encryption correctly)
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
    }

    try {
      await webpush.sendNotification(pushSubscription, pushPayload, { TTL: 86400 })
      return new Response(JSON.stringify({ sent: true }), { status: 200 })
    } catch (pushErr: any) {
      // 410 Gone or 404 = subscription expired — clean it up
      if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('user_id', targetUserId)
        return new Response(JSON.stringify({ cleaned: 'expired subscription removed' }), { status: 200 })
      }
      throw pushErr
    }
  } catch (err: any) {
    console.error('Push notification error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
