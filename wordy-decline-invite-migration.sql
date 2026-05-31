-- ============================================================
-- WORDY — decline-a-friend-invite feature (2026-05-31)
--
-- Adds wordy_decline_invite(p_game_id): lets an invited player remove
-- themselves from a waiting game's invited_user_ids.
--
-- Behavior (per SQ decline decision, card c167):
--   • Caller must be a pending invitee of a WAITING game and not have
--     already joined.
--   • Removes the caller from invited_user_ids.
--   • If that leaves the game with <2 joined players AND no remaining
--     pending invitees (i.e. every invited friend has declined and only
--     the creator is seated), the game is closed with status='cancelled'
--     and close_reason='Invite declined' — we don't silently strand a
--     dead invite, and we don't dump a friend-invite into the public
--     open-games pool. Otherwise the game stays 'waiting' and proceeds
--     short-handed (the existing expiry sweep auto-starts at 2+ / cancels
--     at timeout).
--
-- Notifying the creator on a decline-close is Phase 2 (gated behind the
-- per-game decline-notify opt-in), not this migration.
--
-- Idempotent: safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.wordy_decline_invite(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid                uuid := auth.uid();
  v_game               record;
  v_joined             int;
  v_remaining_invitees int;
BEGIN
  SELECT * INTO v_game FROM public.games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found';
  END IF;
  IF v_game.status <> 'waiting' THEN
    RAISE EXCEPTION 'Game has already started or closed';
  END IF;
  IF v_game.invited_user_ids IS NULL OR NOT (v_uid = ANY(v_game.invited_user_ids)) THEN
    RAISE EXCEPTION 'You were not invited to this game';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.game_players
    WHERE game_id = p_game_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'You have already joined this game';
  END IF;

  -- Remove me from the invite list.
  UPDATE public.games
  SET invited_user_ids = array_remove(invited_user_ids, v_uid)
  WHERE id = p_game_id;

  -- Recompute viability: joined players + remaining pending invitees.
  SELECT count(*) INTO v_joined
  FROM public.game_players WHERE game_id = p_game_id;

  SELECT count(*) INTO v_remaining_invitees
  FROM unnest(
    COALESCE((SELECT invited_user_ids FROM public.games WHERE id = p_game_id), '{}'::uuid[])
  ) AS i(id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.game_players gp
    WHERE gp.game_id = p_game_id AND gp.user_id = i.id
  );

  -- Only the creator remains and every invited friend has bailed → close
  -- it with a reason instead of leaving a dead invite or going public.
  IF v_joined < 2 AND v_remaining_invitees = 0 THEN
    UPDATE public.games
    SET status       = 'cancelled',
        cancelled_at = now(),
        finished_at  = now(),
        close_reason = 'Invite declined'
    WHERE id = p_game_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.wordy_decline_invite(uuid) TO authenticated;
