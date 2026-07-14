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
  return sendPushToUser(supabase, userId, payload, topic)
}

// Helper: send a push notification to a user, cleaning up expired subs.
// Tries the SideQuest hub subscription first (so users who enabled
// notifications in SideQuest get a single consolidated notification),
// falls back to the user's Wordy-specific subscription otherwise.
// The one app every push address is stored under (see sendPushToUser).
const PUSH_APP = 'sidequest'

// ── Transient-failure retry (c276) ───────────────────────────────────────────
// A 5xx / 429 / timeout from a push service is that service having a moment, not
// a dead address. With no retry a single blip silently drops a real turn ping —
// the same player-goes-dark outcome reportAddressDeath (c268) guards the other
// half of. Retry twice with a short backoff; only a failure of every attempt is
// worth reporting.
const PUSH_RETRIES = 2
const PUSH_BACKOFF_MS = [400, 1200]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// No statusCode at all means the request never got an HTTP response back (DNS,
// socket, timeout) — transient too.
function isTransientPushError(err: any): boolean {
  const status = err?.statusCode
  if (status == null) return true
  return status === 429 || status >= 500
}

// web-push's WebPushError message is always the generic "Received unexpected
// response code" — the push service's real status and body hang off the error
// object, never the message. Fold them in so the #error-log line is diagnosable.
function pushErrDetail(err: any, userId: string, app: string, endpoint: string, attempts: number): string {
  let host = 'unknown'
  try { host = new URL(endpoint).host } catch (_e) { /* keep 'unknown' */ }
  const status = err?.statusCode ?? 'no response'
  const body = String(err?.body ?? err?.message ?? err ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  return `push send failed: ${status} — ${body} | app:${app} host:${host} user:${userId} attempts:${attempts}`
}

// Sends, retrying transient failures. 410/404 propagate raw so the caller can run
// its expired-address cleanup; anything else surfaces as an enriched Error.
async function sendWithRetry(
  pushSubscription: any,
  payload: unknown,
  userId: string,
  app: string,
  endpoint: string,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await webpush.sendNotification(pushSubscription, JSON.stringify(payload), { TTL: 86400 })
      return
    } catch (err: any) {
      if (err?.statusCode === 410 || err?.statusCode === 404) throw err
      if (!isTransientPushError(err) || attempt >= PUSH_RETRIES) {
        throw new Error(pushErrDetail(err, userId, app, endpoint, attempt + 1))
      }
      await sleep(PUSH_BACKOFF_MS[attempt])
    }
  }
}

async function sendPushToUser(
  supabase: any,
  userId: string,
  payload: { title: string; body: string; tag: string; url: string; icon?: string },
  topic = 'unknown'
): Promise<{ sent: boolean; reason?: string; via?: string }> {
  // Every push address lives under the unified 'sidequest' app: the hub is the only
  // surface that ever calls pushManager.subscribe, and it hardcodes that value. The
  // old per-game fallback list ('wordy', 'rungles', …) dated from when each game
  // held its own notification settings; nothing has written a per-game row since the
  // unification and none survive in the table, so the loop only ever hit iteration
  // one. Single lookup now — a miss here means the user genuinely has no address.
  const { data: sub } = await supabase
    .from('push_subscriptions')
    .select('endpoint, keys_p256dh, keys_auth')
    .eq('user_id', userId)
    .eq('app', PUSH_APP)
    .maybeSingle()

  if (!sub) return { sent: false, reason: 'no push subscription' }

  const pushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
  }

  try {
    await sendWithRetry(pushSubscription, payload, userId, PUSH_APP, sub.endpoint)
    return { sent: true, via: PUSH_APP }
  } catch (pushErr: any) {
    if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
      await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('app', PUSH_APP)
      await reportAddressDeath('Wordy', userId, PUSH_APP, topic, pushErr.statusCode, sub.endpoint)
      return { sent: false, reason: 'address expired' }
    }
    // One recipient's failed send is not the whole call's failure: throwing here
    // aborted the fan-out loops (game_finished), so the *other* players silently
    // got no push either. Report it and let the caller carry on.
    await reportServerError('Wordy', topic, pushErr?.message ?? String(pushErr))
    return { sent: false, reason: 'send failed' }
  }
}

// Helper: look up a user's display name, falling back to 'Someone'.
async function getUsername(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', userId)
    .maybeSingle()
  return data?.username ?? 'Someone'
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

// Report an unexpected push-function failure to the private #error-log channel
// (c266 Phase 3). Best-effort; never throws. Only the top-level catch calls it,
// so routine 410/404 expired-subscription cleanup (handled inline) never lands here.
const ERRORLOG_WEBHOOK = Deno.env.get('SQ_DISCORD_ERRORLOG_WEBHOOK') ?? ''

// Report an expired-and-deleted push address to #error-log as a low-noise FYI
// (c268). A 410/404 on a *previously-valid* subscription silently darkens a
// real player — the exact blind spot that let Rae's turn pushes vanish for a
// day unnoticed. Distinct from reportServerError (a red alarm from the top-level
// catch): the SW self-heal (c252) + refresh-on-play (c270) re-create the address
// on the next rotation / hub-open / play, so this is an FYI, not an alarm.
async function reportAddressDeath(
  game: string, userId: string, app: string, topic: string, statusCode: number, endpoint: string
) {
  if (!ERRORLOG_WEBHOOK) return
  let host = 'unknown'
  try { host = new URL(endpoint).host } catch (_e) { /* keep 'unknown' */ }
  try {
    await fetch(ERRORLOG_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Rook',
        content: `**${game}** — push address expired (FYI)\n\`${statusCode} → sub deleted\` app:\`${app}\` topic:\`${topic}\` user:\`${userId}\` endpoint:\`${host}\`\nSelf-heal re-subscribes on next rotation / hub-open / play.`,
        allowed_mentions: { parse: [] },
      }),
    })
  } catch (_e) {
    // best-effort: a failed report must never mask the push flow
  }
}

async function reportServerError(game: string, type: string, detail: string) {
  if (!ERRORLOG_WEBHOOK) return
  try {
    await fetch(ERRORLOG_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Rook',
        content: `**${game}** — push function error\n\`${type}\`\ndetail: ${String(detail ?? '').slice(0, 500)}`,
        allowed_mentions: { parse: [] },
      }),
    })
  } catch (_e) {
    // best-effort: a failed report must never mask the original error
  }
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let payload: any = null
  try {
    payload = await req.json()
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

    // ── Type: game_closed (from wordy_auto_start_or_cancel_stale) ─
    // The expire sweep closed a never-filled game (only the creator was
    // seated). Exactly one recipient: the creator. (c151 baseline)
    if (payload.type === 'game_closed') {
      const { record } = payload
      if (!record?.id || !record.created_by) {
        return new Response(JSON.stringify({ skipped: 'missing fields' }), { status: 200, headers: corsHeaders })
      }
      const result = await sendIfOptedIn(supabase, record.created_by, 'wordy', 'game_closed', {
        title: 'Wordy — game closed',
        body: 'Your game closed because no one else joined in time.',
        tag: `wordy-closed-${record.id}`,
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

    // ── Type: game_finished (from on_game_finished trigger) ─────
    // A claim or forfeit ended the game. Push the player who DIDN'T
    // initiate it. Normal completion + admin-close never reach here —
    // the trigger only fires when end_reason ('claim'|'forfeit') is set.
    if (payload.type === 'game_finished') {
      const { record } = payload
      if (!record?.id || !record.forfeit_user_id || !record.end_reason) {
        return new Response(JSON.stringify({ skipped: 'missing fields' }), { status: 200, headers: corsHeaders })
      }
      const loserId = record.forfeit_user_id  // forfeiter, or the claimed-against player
      const { data: players } = await supabase
        .from('game_players')
        .select('user_id')
        .eq('game_id', record.id)
      const winnerId = (players ?? []).find((p: any) => p.user_id !== loserId)?.user_id
      if (!winnerId) {
        return new Response(JSON.stringify({ skipped: 'no opponent' }), { status: 200, headers: corsHeaders })
      }

      // claim   → notify the LOSER (claimed against while idle)
      // forfeit → notify the WINNER (their opponent gave up)
      const isClaim = record.end_reason === 'claim'
      const recipientId = isClaim ? loserId : winnerId

      // Don't push bots (solo-vs-computer games).
      const { data: prof } = await supabase
        .from('profiles').select('is_bot').eq('id', recipientId).maybeSingle()
      if (prof?.is_bot) {
        return new Response(JSON.stringify({ skipped: 'recipient is bot' }), { status: 200, headers: corsHeaders })
      }

      let title: string, body: string
      if (isClaim) {
        title = 'Wordy — game over'
        body = `${await getUsername(supabase, winnerId)} claimed the win because your turn was idle 7+ days.`
      } else {
        title = 'Wordy — you won!'
        body = `${await getUsername(supabase, loserId)} forfeited, you win!`
      }

      const result = await sendIfOptedIn(supabase, recipientId, 'wordy', 'game_finished', {
        title,
        body,
        tag: `wordy-finish-${record.id}`,
        url: `/wordy/game/${record.id}`,
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
    await reportServerError('Wordy', payload?.type ?? 'unknown', err?.message)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
