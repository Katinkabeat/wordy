-- Per-game board layout version.
-- Existing/in-progress games default to 1 (the original Scrabble premium-square
-- layout) so a board already in play never changes underneath the players.
-- New games are created by the client with the current layout version
-- (2 = "Faithful Clipped", an original non-copyrighted layout).
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS board_layout_version INT NOT NULL DEFAULT 1;
