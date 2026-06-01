// Supabase Edge Function: Push-Notification
// Handles four notification types:
//   1. turn_change  — DB webhook fires when games.current_player_idx changes
//   2. player_joined — client POST when someone joins a game
//   3. nudge         — client POST to remind an inactive player it's their turn
//   4. game_invited  — DB webhook fires when a game is created with invitees
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

// Helper: respect the recipient's notification prefs before sending.
// Calls sq_notification_enabled(user, app, topic) — if false, skip
// the send entirely. Fail-open on RPC error so a transient DB blip
// doesn't break the platform.
async function sendIfOptedIn(
  supabase: any,
  userId: string,
  app: string,
  topic: string,
  payload: { title: string; body: string; tag: string; url: string; icon?: string }
): Promise<{ sent: boolean; reason?: string; via?: string }> {
  const { data: enabled, error } = await supabase.rpc('sq_notification_enabled', {
    p_user_id: userId,
    p_app: app,
    p_topic: topic,
  })
  if (error) {
    console.error('sq_notification_enabled failed (fail-open):', error)
  } else if (enabled === false) {
    return { sent: false, reason: 'opted out' }
  }
  return sendPushToUser(supabase, userId, payload)
}

// Helper: send a push notification to a user, cleaning up expired subs.
// Tries the SideQuest hub subscription first (so users who enabled
// notifications in SideQuest get a single consolidated notification),
// falls back to the user's Wordy-specific subscription otherwise.
async function sendPushToUser(
  supabase: any,
  userId: string,
  payload: { title: string; body: string; tag: string; url: string; icon?: string }
): Promise<{ sent: boolean; reason?: string; via?: string }> {
  const apps = ['sidequest', 'wordy']

  for (const app of apps) {
    const { data: sub } = await supabase
      .from('push_subscriptions')
      .select('endpoint, keys_p256dh, keys_auth')
      .eq('user_id', userId)
      .eq('app', app)
      .maybeSingle()

    if (!sub) continue

    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
    }

    try {
      await webpush.sendNotification(pushSubscription, JSON.stringify(payload), { TTL: 86400 })
      return { sent: true, via: app }
    } catch (pushErr: any) {
      if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('app', app)
        // Fall through to the next app (fallback)
        continue
      }
      throw pushErr
    }
  }

  return { sent: false, reason: 'no push subscription' }
}

// Rotating quips for the invite_declined push — funny / bird / dog / ADHD
// flavoured, all warm rather than blunt. One picked at random per send.
// Rae-approved set (2026-05-31).
function declineBody(name: string, emoji: string): string {
  const quips = [
    `${name} flew the coop.`,
    `${name} chickened out.`,
    `${name} ducked out.`,
    `${name}'s not your wingman today.`,
    `${name} chased a squirrel instead.`,
    `${name} rolled over and bailed.`,
    `${name}'s in the doghouse.`,
    `${name} buried this one in the yard.`,
    `${name} got distracted by something shiny.`,
    `${name}'s brain changed the channel.`,
    `Ooh, squirrel — ${name}'s gone.`,
    `${name} flew south for this one.`,
  ]
  const quip = quips[Math.floor(Math.random() * quips.length)]
  return `${quip} Tap to start another. ${emoji}`
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // ── Type: game_invited (from games AFTER INSERT trigger) ────
    // record.invited_user_ids is a uuid[]. Fan out one push per invitee.
    if (payload.type === 'game_invited') {
      const { record } = payload
      if (!record?.id || !record.created_by || !Array.isArray(record.invited_user_ids) || record.invited_user_ids.length === 0) {
        return new Response(JSON.stringify({ skipped: 'missing fields' }), { status: 200, headers: corsHeaders })
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', record.created_by)
        .maybeSingle()
      const inviterName = profile?.username ?? 'Someone'

      const results = []
      for (const inviteeId of record.invited_user_ids) {
        const r = await sendIfOptedIn(supabase, inviteeId, 'wordy', 'invite', {
          title: 'Wordy — game invite',
          body: `${inviterName} invited you to a Wordy game. Tap to play! 🌸`,
          tag: `wordy-invite-${record.id}`,
          url: `/wordy/game/${record.id}`,
          icon: '/wordy/favicon.svg',
        })
        results.push({ invitee: inviteeId, ...r })
      }
      return new Response(JSON.stringify({ results }), { status: 200, headers: corsHeaders })
    }

    // ── Type: invite_declined (from wordy_decline_invite RPC) ───
    // Fired only when a decline closes the game (creator left alone).
    // Gated by the creator's 'invite_declined' pref (default OFF).
    if (payload.type === 'invite_declined') {
      const { game_id, creator_id, decliner_id } = payload
      if (!creator_id) {
        return new Response(JSON.stringify({ skipped: 'no creator' }), { status: 200, headers: corsHeaders })
      }
      let declinerName = 'A friend'
      if (decliner_id) {
        const { data: dp } = await supabase
          .from('profiles').select('username').eq('id', decliner_id).maybeSingle()
        if (dp?.username) declinerName = dp.username
      }
      const result = await sendIfOptedIn(supabase, creator_id, 'wordy', 'invite_declined', {
        title: 'Wordy',
        body: declineBody(declinerName, '🌸'),
        tag: `wordy-declined-${game_id}`,
        url: `/wordy/`,
        icon: '/wordy/favicon.svg',
      })
      return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
    }

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

      const result = await sendIfOptedIn(supabase, game.created_by, 'wordy', 'opponent_joined', {
        title: 'Wordy — Player joined!',
        body: `${joiner_name || 'Someone'} joined your game! 🎉`,
        tag: `wordy-join-${game_id}`,
        url: `/wordy/game/${game_id}`,
        icon: '/wordy/favicon.svg',
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

      const result = await sendIfOptedIn(supabase, currentPlayer.user_id, 'wordy', 'nudge', {
        title: "Wordy — It's your turn!",
        body: `${nudger_name || 'Someone'} is waiting for your move! 🔔`,
        tag: `wordy-nudge-${game_id}`,
        url: `/wordy/game/${game_id}`,
        icon: '/wordy/favicon.svg',
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

    // Solo / bot games use the opt-in `solo_turn` topic (default OFF) instead
    // of `your_turn` — quick downtime games shouldn't nag unless the user opts
    // in (toggle in notification settings).
    const { data: seatProfiles } = await supabase
      .from('game_players')
      .select('profiles(is_bot)')
      .eq('game_id', gameId)
    const isBotGame = (seatProfiles ?? []).some((s: any) => s.profiles?.is_bot)
    const turnTopic = isBotGame ? 'solo_turn' : 'your_turn'

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

    const result = await sendIfOptedIn(supabase, currentPlayer.user_id, 'wordy', turnTopic, {
      title: "Wordy — It's your turn!",
      body: `${moverName} just played. Your move! 🟣`,
      tag: `wordy-turn-${gameId}`,
      url: `/wordy/game/${gameId}`,
      icon: '/wordy/favicon.svg',
    })

    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
  } catch (err: any) {
    console.error('Push notification error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
