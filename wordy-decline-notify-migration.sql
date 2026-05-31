-- ============================================================
-- WORDY — notify creator when a decline closes their game (Phase 2)
--
-- CREATE OR REPLACE of wordy_decline_invite (originally from
-- wordy-decline-invite-migration.sql) to also fire an 'invite_declined'
-- push when the decline strands the game (creator left alone, no other
-- pending invitees). The push is gated per-recipient in the edge fn via
-- sq_notification_enabled('wordy','invite_declined') — default OFF.
-- Multi-seat games that stay waiting short-handed do NOT notify.
-- Idempotent.
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
  -- it with a reason, and notify the creator (gated per-pref in edge fn).
  IF v_joined < 2 AND v_remaining_invitees = 0 THEN
    UPDATE public.games
    SET status       = 'cancelled',
        cancelled_at = now(),
        finished_at  = now(),
        close_reason = 'Invite declined'
    WHERE id = p_game_id;

    BEGIN
      PERFORM net.http_post(
        url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/push-notification',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
        ),
        body := jsonb_build_object(
          'type', 'invite_declined',
          'game_id', p_game_id,
          'creator_id', v_game.created_by,
          'decliner_id', v_uid
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Wordy invite_declined push failed: %', SQLERRM;
    END;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.wordy_decline_invite(uuid) TO authenticated;
