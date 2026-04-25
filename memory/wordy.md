# Wordy — Project Details

## Overview
Multiplayer Scrabble word game built with React + Vite + Supabase, deployed to GitHub Pages.

- **Repo:** github.com/Katinkabeat/wordy
- **Live:** katinkabeat.github.io/wordy/
- **Supabase project:** yyhewndblruwxsrqzart

## Deployment
- GitHub Actions workflow (`deploy.yml`) auto-deploys on push to `main` (also supports manual `workflow_dispatch`)
- `.git` lock files (`index.lock`, `HEAD.lock`, `refs/heads/main.lock`) get stuck on the mounted workspace — use GitHub Git Data API to push commits directly (see Git Push Workaround section below)
- PAT is embedded in the git remote URL; no `workflow` scope so `.github/workflows/` changes must go through GitHub web editor

## Session: March 20, 2026

### Push Notifications — Fixed
**Problem:** Database trigger calling the Edge Function returned 401 because `current_setting('supabase.service_role_key', true)` returns NULL in PostgreSQL trigger context. `supabase_functions.http_request()` has the same issue internally.

**Solution:** Hardcoded the Supabase **anon key** (already public in the frontend bundle) in the trigger's `Authorization` header. The Edge Function creates its own service_role client internally, so anon key auth is sufficient.

**Files changed:**
- `push-webhook-trigger.sql` — trigger uses `net.http_post()` with anon key JWT in the Authorization header
- Trigger fires on `games` table UPDATE when `current_player_idx` changes and `status = 'active'`

**Verified:** `net._http_response` table shows 200 status codes with `{"sent":true}`. Notifications confirmed on both phone and Chrome.

### Last Word Highlighting — Implemented
Board tiles now display in three visual tiers:
1. **Current turn tiles** — lightest purple (`#f3e8ff → #e9d5ff`) with pink ring
2. **Last move tiles** — brighter purple (`#e9d5ff → #d8b4fe`) with purple ring
3. **Older tiles** — standard purple (`#d8b4fe → #c084fc`)

**Files changed:**
- `src/components/game/Board.jsx` — `BoardTile` accepts `isLastMove` prop; three-tier gradient logic
- `src/components/game/GamePage.jsx` — queries `game_moves` table for last move's `tiles_placed`, passes to Board

### Last Move Score on Name Badges — Implemented
Each player's score badge shows the points from their most recent move in green with a `+` prefix (e.g. `142 +24`), displayed to the right of the total score. Only shown when score > 0.

**Files changed:**
- `src/components/game/GamePage.jsx` — fetches each player's last move score from `game_moves`, passes `lastMoveScores` map to ScorePanel
- `src/components/game/ScorePanel.jsx` — displays green `+N` next to total score on both desktop and mobile layouts

### Desktop Score Panel Widened
Sidebar increased from `w-48` (192px) to `w-56` (224px) to fit longer player names. Both the panel and the invisible centering spacer were updated.

### Session: March 21, 2026

### Player-Joined Push Notification — Implemented
**Problem:** `supabase.functions.invoke('Push-Notification', ...)` in `joinGame()` was silently failing on mobile. The `.catch(() => {})` hid the error completely, making it look like the call never happened.

**Root cause:** `supabase.functions.invoke()` attaches the user's session token alongside the anon key. On mobile, something in the auth token flow caused the request to fail (likely token refresh timing or stale session). Because errors were silently caught, this was invisible.

**Solution:** Replaced `supabase.functions.invoke()` with a direct `fetch()` call using only the anon key. The Edge Function doesn't need user auth — it just needs the game_id to look up the creator. Added `console.log`/`console.warn` so future errors are visible.

**Key lesson (applies to ALL Supabase Edge Function calls):**
> When an Edge Function doesn't need user authentication, prefer a direct `fetch()` with the anon key over `supabase.functions.invoke()`. The JS client's invoke method adds session token complexity that can fail silently. Direct fetch is more reliable and easier to debug.

**Files changed:**
- `src/components/lobby/LobbyPage.jsx` — `joinGame()` now uses direct `fetch()` to `/functions/v1/Push-Notification` with anon key auth
- Edge Function `Push-Notification` (on Supabase) — handles both `player_joined` (from client) and `turn_change` (from DB webhook) notification types, includes CORS preflight handling

**Other gotchas found during debugging:**
- Edge Function name is case-sensitive: `Push-Notification` (capital P, N)
- Must handle OPTIONS preflight before parsing `req.json()` or CORS fails
- `index.lock` still can't be removed on mounted filesystem — always use GitHub Contents API to push

### Session: March 23, 2026

### Race Condition Fix — Real-time Reloads During Move Submission
**Problem:** After submitting a move, the played tile stayed in the rack. The `games` table update triggered a real-time subscription → `loadGame()` → fetched old `game_players` rack (second write hadn't happened yet) → overwrote correct local state with stale DB data.

**Solution:** Added `mutatingRef` guard that suppresses real-time-triggered `loadGame()` while sequential DB writes are in progress. After all writes complete, an explicit `loadGame({ force: true })` ensures consistent state. Added error handling to all DB writes.

### Duplicate Tiles Fix — loadGame on Validation Failure
**Problem:** When `submitWord()` failed validation (invalid word), the `finally` block called `loadGame({ force: true })` which reset the rack to the full DB value without clearing `placements`. The stale placements then caused duplicate tiles when interacting with the rack (recall, clicking cells spliced stale tiles back into the already-full rack).

**Solution:** Restructured `submitWord()` into two phases:
- **Validation phase:** No mutation guard, no loadGame on failure. Local state stays correct (tiles on board, removed from rack, tracked by placements).
- **DB write phase:** Mutation guard + loadGame only run when writes are actually attempted.

Also: `loadGame()` now always clears `placements` when it runs (safety net against stale state from any code path).

**Key lesson:**
> Never call `loadGame()` (which resets board + rack from DB) without also clearing `placements`. The three pieces of state — `board`, `myPlayer.rack`, and `placements` — must stay in sync. `loadGame()` resets board/rack but doesn't know about placements, so always `setPlacements([])` alongside it.

**Files changed:**
- `src/components/game/GamePage.jsx` — restructured `submitWord()`, added `mutatingRef`, error handling on all DB writes, `loadGame()` clears placements

### Session: March 24, 2026

### Settings Dropdown — Implemented
Replaced standalone header buttons (theme toggle, admin, logout) with a single settings cog (`⚙️`) that opens a dropdown menu.

**Architecture:**
- `src/components/lobby/SettingsModal.jsx` — despite the filename, this is now a **dropdown** component (not a modal). Positioned with `absolute right-0` inside a `relative` container.
- Click-outside detection via `mousedown` event listener + `useRef`; also closes on Escape key
- Sections: name edit (inline), password change (expandable), tile colour picker trigger, theme toggle, admin toggle (admin-only), logout

**Props:** `{ profile, onClose, onProfileUpdate, isDark, toggleTheme, isAdmin, lobbyTab, onToggleAdmin, onLogout }`

**CSS:** `.settings-dropdown`, `.settings-row`, `.settings-section` classes in `index.css` with animation and dark mode support

### Password Change — Implemented
Expandable section inside settings dropdown. Verifies old password via `signInWithPassword` before allowing change. New password requires at least one number and one special character. Inline validation messages shown.

### Registration Disabled
Auth page (`src/components/auth/AuthPage.jsx`) now shows login only — signup tab and "Don't have an account?" link removed. Registration code still exists but is unreachable. **Important:** Also disable registration in Supabase Dashboard → Authentication → Settings for full security.

### Tile Colour Customization — Implemented (Updated March 24)
Players can choose from 4 tile colours that persist on the board after placement. Changing colour mid-game updates all previously placed tiles.

**Core colour system** (`src/lib/tileColors.js`):
- `TILE_COLOR_OPTIONS` — 4 colours: Purple (270), Pink (330), Blue (220), Grey (-1)
- `DEFAULT_TILE_HUE = 270` (purple)
- `GREY_HUE = -1` — sentinel value; style functions detect this and output zero-saturation HSL
- `tileStyle(hue, dark)` — generates rack tile inline styles (bg gradient, border, shadow, text colours)
- `boardTileStyle(hue, age, dark)` — generates board tile styles with three tiers (new/lastMove/old)
- **Dark mode:** Bright pastel gradients (68–92% lightness) with glow `box-shadow` — tiles must be bright on dark board, NOT dark gradients

**Colour picker** (`src/components/lobby/TileColorPicker.jsx`):
- Modal popup triggered from settings dropdown
- 4-column grid of colour swatches with live "WORDY" preview tiles
- Saves `tile_hue` to `profiles` table

**Database:** `tile_hue INT DEFAULT 270` column on `profiles` table. Grey stores `-1`.

**Board persistence & live colour updates:**
- Board cells store `{ letter, isBlank, hue, uid }` — `uid` is the user_id of the player who placed the tile
- `Board.jsx` receives `profiles` prop and does a live lookup: if `cell.uid` exists, uses `profiles[cell.uid].tile_hue` instead of the stored `cell.hue`
- This means changing colour in settings immediately updates all your tiles on the board (on next page load/visibility change)
- Legacy tiles without `uid` (placed before this update) fall back to their stored `hue`
- `boardData.js` — `deserializeBoard` preserves both `hue` and `uid` fields

**Files changed:**
- `src/lib/tileColors.js` — core colour system (reduced to 4 colours, added grey support)
- `src/components/lobby/TileColorPicker.jsx` — colour picker UI
- `src/lib/boardData.js` — `deserializeBoard` preserves `hue` and `uid` fields on cells
- `src/components/game/Board.jsx` — accepts `profiles` prop; `BoardTile` uses live profile hue when `uid` available, falls back to stored `hue`
- `src/components/game/TileRack.jsx` — uses `tileStyle(tileHue, isDark)` for inline styles; accepts `tileHue` and `isDark` props
- `src/components/game/GamePage.jsx` — profiles map is `{id: {username, tile_hue}}`; `placeTile` stores `hue` and `uid` on board cells; passes `profiles` to Board component
- `src/components/game/ScorePanel.jsx` — all `profiles[id]` → `profiles[id]?.username`

**Key gotchas:**
> The profiles map type change (`string` → `{username, tile_hue}`) breaks every `profiles[id]` reference. When modifying the profiles map shape, grep for ALL usages in GamePage.jsx and ScorePanel.jsx.
> Grey hue sentinel (-1) must be handled in both `tileStyle()` and `boardTileStyle()` — they check `hue === GREY_HUE` and set saturation to 0.

### Random First Player — Implemented
When the last player joins and the game starts, the first player is now randomized:
```js
const randomFirst = Math.floor(Math.random() * game.max_players)
await supabase.from('games').update({ status: 'active', current_player_idx: randomFirst }).eq('id', game.id)
```
Changed in `src/components/lobby/LobbyPage.jsx` → `joinGame()`.

### Git Push Workaround (Updated March 24)
`.git/index.lock`, `HEAD.lock`, and `refs/heads/main.lock` get stuck on the mounted workspace and can't be removed (`Operation not permitted`). Local git commits are impossible.

**Best workaround: GitHub Git Data API.** Push commits directly without needing local git:
1. Get current HEAD SHA: `GET /repos/{owner}/{repo}/git/ref/heads/main`
2. Get tree SHA from that commit: `GET /repos/{owner}/{repo}/git/commits/{sha}`
3. Create blobs for each changed file: `POST /repos/{owner}/{repo}/git/blobs`
4. Create new tree with those blobs: `POST /repos/{owner}/{repo}/git/trees` (with `base_tree`)
5. Create commit: `POST /repos/{owner}/{repo}/git/commits` (with parent SHA)
6. Update ref: `PATCH /repos/{owner}/{repo}/git/refs/heads/main`

PAT is embedded in the git remote URL. Use `git remote get-url origin` to extract it.

**Previous workaround (deprecated):** Clone fresh to `/sessions/` temp dir, copy files, commit from clean clone. The API approach above is faster and more reliable.

### Enlarged Board Tile Letters for Mobile
Increased font size of placed tile letters and point values on the board for better readability on phones.

**Changes in `src/components/game/Board.jsx`:**
- Letter size: `cellSize * 0.38` → `cellSize * 0.48` (~26% larger), minimum 8→10px
- Point value size: `cellSize * 0.22` → `cellSize * 0.26`, minimum 5→6px
- Bonus label size unchanged (`cellSize * 0.26`)

At default `cellSize = 36`, letters go from ~14px to ~17px. Layout uses flexbox centering so no overflow issues.

### Session: March 26, 2026

### Nudge Feature — Implemented
**Purpose:** Allow opponents to send a push notification reminder to the player whose turn it is, if they've been inactive for 12+ hours. Only one nudge per game per 12-hour window (not per opponent).

**Database changes (`nudge-migration.sql`):**
- `games.turn_started_at TIMESTAMPTZ` — auto-set via BEFORE trigger when `current_player_idx` changes or game becomes active
- `games.last_nudged_at TIMESTAMPTZ` — set by client when nudge is sent
- Backfill query sets `turn_started_at` for existing active games using most recent move time

**Frontend changes (`src/components/lobby/LobbyPage.jsx`):**
- `loadGames()` now also selects `turn_started_at, last_nudged_at`
- `GameRow` receives `profile` prop (for nudger's username)
- Nudge eligibility: active game + not my turn + `turn_started_at` > 12h ago + `last_nudged_at` null or > 12h ago
- Bell icon (🔔) appears inside the current player's name pill, before their name
- On click: updates `last_nudged_at` on game, calls Edge Function with `type: 'nudge'`
- `justNudged` local state prevents double-tap; bell disappears after sending

**Edge Function (`supabase/functions/push-notification/index.ts`):**
- Refactored into a shared `sendPushToUser()` helper
- Added `nudge` type handler: receives `{ type: 'nudge', game_id, nudger_name }`, looks up current player, sends push
- Added CORS headers to all response paths
- Now handles three types: `turn_change` (DB webhook), `player_joined` (client), `nudge` (client)

**Key gotchas:**
> The `turn_started_at` trigger fires on `current_player_idx` change OR `status` going from `waiting` → `active`, covering the case where random first player is index 0 (same as default).
> The `last_nudged_at` update goes through normal RLS ("games: update player" policy) — only game participants can update it.
> If `turn_started_at` is NULL (old games before migration with no backfill match), nudge won't appear — this is intentional to avoid false nudges.

**Deployment steps:**
1. Run `nudge-migration.sql` in Supabase SQL Editor
2. Deploy updated Edge Function: `supabase functions deploy Push-Notification`
3. Push frontend code to GitHub (triggers GitHub Actions deploy)

### Session: April 21, 2026

### Cross-Game Notification Bug — Fixed
**Problem:** Wordy turn notifications were showing up with the Rungles icon (and opening the Rungles app on tap) for some users. Reported after Rungles launched on the shared Supabase project.

**Root cause:** `push_subscriptions` had `UNIQUE(user_id)` — only one endpoint per user across both apps. Wordy's `/wordy/sw.js` and Rungles' `/rungles/sw.js` each create their own push subscription with a different endpoint (different SW scopes). Both apps' `saveSubscription` upserted to the same row with `onConflict: 'user_id'`, so whichever app ran last overwrote the other. Rungles calls `resyncPushSubscription` on every banner render, so it routinely overwrote Wordy's endpoint. When Wordy's trigger then fired, the push was delivered to `/rungles/sw.js`, which uses `/rungles/favicon.svg` as the icon — Wordy's title/body but Rungles' icon.

**Fix:** scoped the subscriptions table by app.

1. **Migration** (`push-subscriptions-app-column-migration.sql`): added `app TEXT NOT NULL` column, backfilled existing rows to `'wordy'`, dropped `UNIQUE(user_id)`, added `UNIQUE(user_id, app)`, replaced the per-user index with `(user_id, app)`.
2. **Wordy frontend** (`src/lib/pushNotifications.js`): `const APP = 'wordy'`, all upserts include `app: APP` with `onConflict: 'user_id,app'`, delete scoped by `.eq('app', APP)`.
3. **Wordy edge function** (`supabase/functions/push-notification/index.ts`): `sendPushToUser` now filters `.eq('app', 'wordy')`, cleanup delete for 410/404 scoped by app too.
4. **Rungles frontend** (`js/notifications.js`): same pattern with `APP = 'rungles'`.
5. **Rungles edge function** (`supabase/functions/rungles-push-notification/index.ts`): same filter with `'rungles'`.

**Cleanup script** (`push-subscriptions-dedupe-stale-wordy-rows.sql`): the migration defaulted ALL existing rows to `app='wordy'`, but some of those rows actually held Rungles SW endpoints (because Rungles had last overwritten the shared row). Detected these by joining `wordy` rows against same-user `rungles` rows with identical endpoints and deleting the stale `wordy` row. Affected users silently skip their next Wordy push and self-heal on next Wordy lobby open (resync recreates the row with the real Wordy endpoint).

**Key lesson:**
> When two apps share a Supabase project AND share a table keyed only by user_id, the app that writes last wins. Always scope shared per-user tables by app when both apps write to them — add an `app` column to the unique key, not just the data.

**Wordy-only `wordy` rows** (users with no matching `rungles` row) can't be detected as stale from SQL. Decided to wait and let them self-heal on next Wordy open rather than preemptively nuking pre-deploy rows.

**Deployment steps taken:**
1. Ran migration in Supabase SQL Editor.
2. Re-deployed both edge functions via Supabase dashboard (paste-in code editor — no CLI).
3. Pushed Wordy frontend via GitHub Git Data API (commit `74779010`).
4. Pushed Rungles frontend via normal git (commit `d643f61`).
5. Ran dedupe SQL to remove stale duplicate endpoints.

### Pending
- Add iOS detection prompt guiding users to install Wordy to Home Screen for push notification support (iOS Web Push requires PWA, applies to all iOS browsers since they all use WebKit)
- Consider adding settings cog to game page (not just lobby) — decided to revisit later
- Local git repo is mid-rebase (`main` diverged from `origin/main` with 5 local vs 31 remote commits). Needs `git rebase --abort` from a terminal with write access to `.git` to resolve
- **Before going public: change the multiplier square arrangement.** Scrabble's specific board layout (the placement of DL/TL/DW/TW squares) is trademarked by Hasbro/Mattel. Wordy's current board copies that layout. Rearrange the premium squares to a different pattern before any public launch — the mechanic itself is fine, just not the exact arrangement.

## 2026-04-25: notification opt-in moved to SideQuest hub

Removed `<NotificationBanner>` from `LobbyPage.jsx` (and dropped its import). Push opt-in now lives only in the SideQuest hub (`Settings → Notifications`). Friends who already enabled notifications via Wordy keep working — the SideQuest hub auto-migrates them to a unified `app='sidequest'` push subscription on their next hub visit (silent, no UI prompt because permission is already granted on the origin), then unsubscribes the per-game SW push managers and deletes the `app='wordy'` row from `push_subscriptions`.

`NotificationBanner.jsx` and `pushNotifications.js` are still in the repo for now in case we need to restore them. Edge function (`push-notification`) is unchanged — it still queries `app='sidequest'` first, falls back to `app='wordy'`. The fallback path will rarely trigger after migration but stays as defense-in-depth.

Migration helper lives at `rae-side-quest/src/lib/pushNotifications.js` → `migrateToSideQuestPush(userId)`.
