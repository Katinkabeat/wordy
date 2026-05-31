-- ============================================================
--  Persistent Solo games (card c159)
--
--  Makes a Solo game a REAL game: creator + bot(s) seated in one
--  atomic SECURITY DEFINER call, so it persists / resumes / lists.
--  Plus: pairwise-by-score vs-character stats (so placing 2nd of 4
--  records wins vs the bots you OUTSCORED, not a blanket loss), and
--  a quit-solo-game delete.
--
--  Shared prod yyhewndblruwxsrqzart. Apply with Rae's confirmation.
-- ============================================================

-- 1. Create a real game seeded with the creator + bot(s) ---------------------
--    Client computes the bag + racks (reusing tileData), passes them in.
--    Validates seat 0 = caller and every other seat is a real bot, so this
--    can't be abused to fabricate games with other humans.
CREATE OR REPLACE FUNCTION public.create_game_with_bots(
  p_board              JSONB,
  p_tile_bag           TEXT[],
  p_layout_version     INT,
  p_players            JSONB,   -- [{user_id, player_index, rack[]}], seat 0 = creator
  p_current_player_idx INT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_creator   UUID := auth.uid();
  v_game_id   UUID;
  v_player    JSONB;
  v_count     INT;
  v_first_uid UUID;
  v_first_bot BOOLEAN;
BEGIN
  IF v_creator IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_count := jsonb_array_length(p_players);
  IF v_count < 2 OR v_count > 4 THEN RAISE EXCEPTION 'Invalid player count'; END IF;

  FOR v_player IN SELECT * FROM jsonb_array_elements(p_players) LOOP
    IF (v_player->>'player_index')::int = 0 THEN
      IF (v_player->>'user_id')::uuid <> v_creator THEN RAISE EXCEPTION 'Seat 0 must be the creator'; END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = (v_player->>'user_id')::uuid AND is_bot) THEN
      RAISE EXCEPTION 'Non-creator seats must be computer players';
    END IF;
  END LOOP;

  INSERT INTO public.games (status, max_players, current_player_idx, board, tile_bag, board_layout_version, created_by)
  VALUES ('active', v_count, p_current_player_idx, p_board, p_tile_bag, p_layout_version, v_creator)
  RETURNING id INTO v_game_id;

  FOR v_player IN SELECT * FROM jsonb_array_elements(p_players) LOOP
    INSERT INTO public.game_players (game_id, user_id, player_index, rack)
    VALUES (v_game_id, (v_player->>'user_id')::uuid, (v_player->>'player_index')::int,
            ARRAY(SELECT jsonb_array_elements_text(v_player->'rack')));
  END LOOP;

  -- Kick off the first move if a bot is first (INSERT doesn't fire on_bot_turn,
  -- which is AFTER UPDATE). Subsequent turns use the normal trigger.
  SELECT gp.user_id INTO v_first_uid FROM public.game_players gp
    WHERE gp.game_id = v_game_id AND gp.player_index = p_current_player_idx;
  SELECT is_bot INTO v_first_bot FROM public.profiles WHERE id = v_first_uid;
  IF v_first_bot IS TRUE THEN
    BEGIN
      PERFORM net.http_post(
        url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/bot-move',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
        ),
        body := jsonb_build_object('record', (SELECT row_to_json(g) FROM public.games g WHERE g.id = v_game_id))
      );
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'bot kickoff failed: %', SQLERRM; END;
  END IF;

  RETURN v_game_id;
END $$;
GRANT EXECUTE ON FUNCTION public.create_game_with_bots(JSONB, TEXT[], INT, JSONB, INT) TO authenticated;

-- 2. Pairwise-by-score stats for games containing a bot ----------------------
--    "You beat a character if you OUTSCORED them" — so 2nd of 4 records wins
--    vs the bots below you and a loss only vs the one above. Human-vs-bot
--    pairs only (no bot-vs-bot pollution).
CREATE OR REPLACE FUNCTION public.record_bot_game_result(p_game_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE h RECORD; b RECORD;
BEGIN
  FOR h IN
    SELECT gp.user_id, gp.score FROM public.game_players gp
    JOIN public.profiles p ON p.id = gp.user_id
    WHERE gp.game_id = p_game_id AND p.is_bot IS NOT TRUE
  LOOP
    FOR b IN
      SELECT gp.user_id, gp.score FROM public.game_players gp
      JOIN public.profiles p ON p.id = gp.user_id
      WHERE gp.game_id = p_game_id AND p.is_bot = TRUE
    LOOP
      INSERT INTO public.player_matchups (player_id, opponent_id, wins, losses, updated_at)
      VALUES (h.user_id, b.user_id,
              CASE WHEN h.score > b.score THEN 1 ELSE 0 END,
              CASE WHEN h.score > b.score THEN 0 ELSE 1 END, NOW())
      ON CONFLICT (player_id, opponent_id) DO UPDATE
        SET wins = player_matchups.wins + EXCLUDED.wins,
            losses = player_matchups.losses + EXCLUDED.losses, updated_at = NOW();

      INSERT INTO public.player_matchups (player_id, opponent_id, wins, losses, updated_at)
      VALUES (b.user_id, h.user_id,
              CASE WHEN b.score > h.score THEN 1 ELSE 0 END,
              CASE WHEN b.score > h.score THEN 0 ELSE 1 END, NOW())
      ON CONFLICT (player_id, opponent_id) DO UPDATE
        SET wins = player_matchups.wins + EXCLUDED.wins,
            losses = player_matchups.losses + EXCLUDED.losses, updated_at = NOW();
    END LOOP;
  END LOOP;
END $$;

-- 3. finish_game branches: bot games → pairwise; human games → unchanged -----
CREATE OR REPLACE FUNCTION public.finish_game(p_game_id UUID, p_player_results JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE pr JSONB; v_has_bot BOOLEAN;
BEGIN
  FOR pr IN SELECT * FROM jsonb_array_elements(p_player_results) LOOP
    UPDATE public.game_players
       SET score = (pr->>'score')::INT, is_winner = (pr->>'is_winner')::BOOLEAN
     WHERE game_id = p_game_id AND user_id = (pr->>'user_id')::UUID;
  END LOOP;

  SELECT EXISTS (
    SELECT 1 FROM public.game_players gp JOIN public.profiles p ON p.id = gp.user_id
    WHERE gp.game_id = p_game_id AND p.is_bot = TRUE
  ) INTO v_has_bot;

  IF v_has_bot THEN
    PERFORM public.record_bot_game_result(p_game_id);  -- pairwise-by-score
  ELSE
    PERFORM public.record_game_result(p_game_id);      -- existing binary human stats
  END IF;
END $$;

-- 4. Quit a Solo game (creator deletes a game that contains a bot) ------------
--    Not a forfeit, not a recorded loss — just removes the practice game.
CREATE OR REPLACE FUNCTION public.quit_solo_game(p_game_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.games g
    WHERE g.id = p_game_id AND g.created_by = auth.uid()
      AND EXISTS (SELECT 1 FROM public.game_players gp JOIN public.profiles p ON p.id = gp.user_id
                  WHERE gp.game_id = g.id AND p.is_bot = TRUE)
  ) THEN
    RAISE EXCEPTION 'Not your Solo game';
  END IF;
  DELETE FROM public.games WHERE id = p_game_id;  -- cascades game_players + game_moves
END $$;
GRANT EXECUTE ON FUNCTION public.quit_solo_game(UUID) TO authenticated;
