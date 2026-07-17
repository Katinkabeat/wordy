# Wordy — Project Details

## Overview
Multiplayer Scrabble word game built with React + Vite + Supabase, deployed to GitHub Pages.

- **Repo:** github.com/Katinkabeat/wordy
- **Live:** katinkabeat.github.io/wordy/
- **Supabase project:** yyhewndblruwxsrqzart

## Session: 2026-07-12 — notification-tap routing fix (c274)
Cross-game fix for push taps opening the wrong board / doing nothing when the installed PWA is already open (Rae hit it as "tapping a Wordy notification while on a different Wordy board did nothing"). Wordy's part: `main.jsx` now calls `installNotificationNav()` (new sq-ui helper) — the hub SW posts a `{type:'NAVIGATE', url}` message on tap and this navigates the open app to the target board. `openWindow` was a no-op inside an already-running installed PWA on Android (the root cause). Commit `920ac35`. Substantive fix lives in the hub (`public/sw.js` + `sq-ui/utils/notificationNav.js`); this game only wires the receiver. See `rae-side-quest` memory + auto-memory `feedback_sq_notification_click_routing`.

## Deployment
- GitHub Actions workflow (`deploy.yml`) auto-deploys on push to `main` (also supports manual `workflow_dispatch`)
- `.git` lock files (`index.lock`, `HEAD.lock`, `refs/heads/main.lock`) get stuck on the mounted workspace — use GitHub Git Data API to push commits directly (see Git Push Workaround section below)
- PAT is embedded in the git remote URL; no `workflow` scope so `.github/workflows/` changes must go through GitHub web editor

## Session: June 7, 2026 — How-to: inactive-player rules documented

Added a "When a player goes quiet" section at the bottom of `HowToPlayModal.jsx`:
🔔 nudge appears on the opponent's lobby chip after 12h idle; claim-win from the
settings cog ⚙ after 7 days idle. Pure copy, no logic change. Committed + pushed.
Part of a 4-game sweep (Raeban c185) documenting the shared inactive-player rules.

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

## 2026-04-25: Phase 1 of unified-auth migration

Wordy no longer hosts its own login UI for unauthed users in production. When `session === null && !isRecovery`, `App.jsx` redirects to `${origin}/games/?return=<current-path-and-query>`. The SQ hub validates the `return` param against an allowlist of game prefixes and bounces the user back to Wordy after authenticating. Notification deep links into `/wordy/game/<id>` survive a logged-out re-entry through this round-trip.

Recovery emails issued before the migration still land at `/wordy/auth#type=recovery` and use the in-app "Set new password" form; new emails go to `/games/` where SQ now hosts the equivalent recovery UI.

The redirect is gated to `window.location.hostname === 'katinkabeat.github.io'`. Local dev keeps using the in-app login form (handy because `/games/` doesn't exist on a localhost Vite server).

`AuthPage.jsx` and its forgot-password flow are now unreachable for unauthed users in production. They stay in the repo for now (used only when `isRecovery` is true). Phase 2 will remove them and the `redirectTo: SITE_URL` reset call once in-flight legacy emails have aged out.

## 2026-04-25: SideQuest service worker push fixes

After Phase 1 routed everyone through the hub, the auto-migration moved push subscriptions to `app='sidequest'` for both Wordy and Rungles. That meant the SQ service worker (`rae-side-quest/public/sw.js`) became responsible for all turn-change push events. Two pre-existing bugs in that SW immediately broke Wordy notifications:

1. **Cross-scope navigation lost.** The SW posts `{type:'NAVIGATE', url}` to a focused SQ tab when the click target is outside the SQ scope (e.g. `/wordy/game/<id>`). The SQ React app had no listener for that message, so clicks focused the SQ tab and then did nothing. Fix: added a `serviceWorker` `message` listener in `rae-side-quest/src/App.jsx` that does `window.location.href = event.data.url`.
2. **Over-eager focus suppression.** The push handler suppressed the notification when any focused tab's URL contained the target URL. For a turn-based game where the user is *waiting on the board*, that's exactly when the "your turn" alert matters most. Fix: removed the suppression — always call `showNotification`.

These bugs hadn't manifested before because most users still had `app='wordy'` rows handled by Wordy's own SW (`/wordy/sw.js`), which has correct routing/notification logic. Phase 1 forced everyone into the migration, exposing the SQ SW bugs.

After deploying these fixes, devices need to reload to pick up the new SW (the SW has `skipWaiting`+`clients.claim`, so the new version takes over on next app open / hard reload).

## 2026-04-25: Phase 2 — in-app login UI removed

`src/components/auth/AuthPage.jsx` is gone, along with the `auth/` directory it lived in. `App.jsx` was rewritten to redirect every unauthed visitor to the SQ hub: legacy `/wordy/#type=recovery` emails are forwarded to `/games/<hash>` so SQ's recovery handler picks up the password-update flow; everyone else goes to `/games/?return=<original-url>` so post-login routing brings them back where they were heading. The `/auth` route and the `shouldRedirectToHub()` hostname guard are both gone — the redirect now fires unconditionally because the unified-origin local dev environment has `/games/` reachable on localhost too.

`LobbyPage.jsx`'s logout button used to navigate to `/wordy/auth` (the in-app login UI); it now points at `/games/`.

This was paired with a unified-origin local dev setup in `rae-side-quest/package.json` (`npm run dev:all`) plus Vite proxy config. Without that, deleting the in-app form would have made local dev impossible. With it, dev mirrors prod — log in at `localhost:8080/games/`, navigate to `/wordy/`, session carries via shared localStorage on the same origin.

Verified end-to-end in the local dev env before pushing: logged-in routing intact, logged-out redirects to SQ login with the correct `?return=` param, post-login bounces back to the originating Wordy URL.

## 2026-04-28: Lobby restructure + perf code-split + GamePage/LobbyPage refactor

Three changes shipped in this session, all on `main`:

**Lobby restructure (commits 7ef37cc + 68ce110):** Merged `🎮 My Games` and `🚪 Open Games` into one `🎮 Multiplayer` section card with open joinable games at the top, then my active games. Finished-game banners moved into a new `🏁 Completed Games` section card below Multiplayer with a Rungles-style gradient pill look (`from-wordy-100 to-pink-50` → `from-wordy-900/40 to-purple-900/30`, rounded-xl, ✕ dismiss button on the right). The long underlined "View final board →" link inside the banner was replaced with a compact right-justified "View Game" text button just left of ✕. The score line shows just `allPlayerNames` with no extra prefix.

**Perf code-split (commit af79613):** Routes (`LobbyPage`, `GamePage`, `StatsPage`) and `AdminPanel` converted to `React.lazy()` imports with `<Suspense>` boundaries. The lobby's initial JS download dropped from 422.89 kB → 376.34 kB (~12 kB saved over the wire after gzip). Game/Stats/Admin code now downloads only when the user navigates to those pages. `node_modules` was reinstalled during this work to repair a corrupted local `vite` shim — `npm run build` works cleanly again.

**Refactor (commit dd00106):** Extracted `finalizeEndgame(players, emptyingPlayerId)` into `src/lib/gameLogic.js` and added local helpers `endgameFields(over)` + `callFinishGameRpc(gameId, finalPlayers)` to GamePage. The three move functions (`submitMove`, `passTurn`, `confirmExchange`) used to each contain near-duplicate end-game finalize and finish_game RPC blocks; they now call the helpers. `GamePage.jsx` 886 → 871 lines. Separately, the embedded 132-line `GameRow` sub-component lifted out of `LobbyPage.jsx` into `src/components/lobby/LobbyGameRow.jsx`. `LobbyPage.jsx` 622 → 485 lines (~22% smaller). No behavior change in either refactor; build verified clean (six chunks, same shape as before).

### Future-session candidates flagged in this session

These were flagged as worth doing but out of scope for the session:

1. **Extract `createGame` and `joinGame` to `src/lib/gameMutations.js`** — both are pure data operations sitting inside `LobbyPage.jsx` (~70 lines). Moving them out continues the LobbyPage cleanup arc started here.
2. **Custom hook `useUnseenResults(user, navigate)`** — the unseen-results system in `LobbyPage.jsx` (the `loadUnseenResults` callback, `dismissResult`, `handleGameChange`'s finish-toast block, the realtime subscription wiring) is ~80 lines that could become a reusable hook. Cleanly separates the "show result banners" feature from the lobby's main concerns.
3. **Trim the shared `index.js` chunk** — still 355 kB (105 kB gzipped) after the route split. Worth investigating with `vite-bundle-visualizer` or similar to see if there's something heavy in the shared core (likely `@supabase/supabase-js`, `react-router-dom`, or unused tailwind utilities). Only worth doing if Wordy still feels slow in practice.

### General React+Vite watch-fors saved as auto-memory

`feedback_react_perf_codesplit.md` in user auto-memory captures the patterns from this session for future React+Vite work across all SQ games: lazy-load admin/settings/route-only code, use the build report as the perf health check, etc.

## 2026-04-28: GamePage refactor round 1 — extracted `useGameData` hook

First refactor pulled from the new cross-project backlog at `rae-side-quest/docs/refactor-backlog.md`. Walked through the `/refactor` skill (explore → plan → test → refactor → explain).

**What moved:** All "load this game and keep it fresh" logic out of `GamePage.jsx` into a new `wordy/src/hooks/useGameData.js`. The hook owns `game`/`players`/`myPlayer`/`board`/`profiles`/`lastMoveTiles`/`lastMoveScores`/`loadError` state, the `mutatingRef`/`placementsRef`/`localRackRef`/`channelRef` refs, the `loadGame` function (3-phase fetch with race protection), the realtime subscription, the 10-second polling fallback, and the visibility-change re-sync.

**What stayed:** `placements` state (lives with the move/placement logic), all the move actions (`submitWord`, `passTurn`, `confirmExchange`, `forfeitGame`), the local UI state (`selectedTile`, `submitting`, `exchangeMode`, modals, etc.), and the entire render. `placementsRef` is still mirrored from `placements` in GamePage via a `useEffect` since the placements state is owned by the component but the ref needs to be readable from the hook's interval callbacks.

**Subtle behavior preserved:** Removed the `setPlacements([])` line that lived inside `loadGame`'s success path — but it was always a no-op safety net (the function bails earlier if placements are non-empty and not forced; on `force:true` calls all callers had already cleared placements). Net behavior identical.

**Numbers:** GamePage.jsx 871 → 721 lines (-17%). New `useGameData.js` 186 lines. GamePage chunk 30.88 kB → 31.26 kB (+0.38 kB, +0.17 kB gzipped) — small overhead from hook indirection, not worth optimizing.

**Verification:** `npm run build` clean. Rae confirmed in `npm run dev:all` that loading a game, render, settings menu, and dark mode toggle all work. Polling/visibility/move-action verification deferred — those code paths are unchanged from before, just relocated.

**Backup:** `wordy/src/components/game/GamePage.jsx.pre-refactor-2026-04-28.bak` (delete on commit if everything stays good).

### Next refactor candidates queued in backlog

- ~~Round 2: extract `useGameMutations` hook~~ — done 2026-04-29 (see below).
- Round 3: lift `BlankTileModal` and `ForfeitModal` into their own files.

## Session: April 29, 2026

### Round 2 GamePage refactor: `useGameMutations` hook — done

Pulled all four DB mutations + their helpers out of `GamePage.jsx` into a dedicated hook at `src/hooks/useGameMutations.js`. Pairs with the existing `useGameData.js` (reads): now reads and writes live in sibling hooks, GamePage is pure UI + local state.

**Files:**
- `src/hooks/useGameMutations.js` (new, 240 lines) — owns `submitWord`, `passTurn`, `confirmExchange`, `forfeitGame`, plus `endgameFields()` and `callFinishGameRpc()` helpers (previously module-level in GamePage).
- `src/components/game/GamePage.jsx` — removed inline handlers, dropped associated imports (supabase, refillRack, serializeBoard, validatePlacement, isGameOver, finalizeEndgame, validateWords, toast — most no longer needed at the GamePage level).

**Hook signature** — receives all dependencies as a single options object: game/players/myPlayer, board, placements + setPlacements, exchange selection state, setForfeitModal, gameId, user, loadGame, mutatingRef, isFirstMove, isMyTurn, recall. Returns `{ submitting, submitWord, passTurn, confirmExchange, forfeitGame }`. Lots of params, but it's exactly what the mutation flows genuinely need; resisting the urge to wrap into a less-explicit `ctx`.

**Numbers:** GamePage 735 → 524 lines (-211). Total LOC up slightly (imports + hook signature) but cleanly separated. No bundle-size measurements taken — refactor only.

**Verification:** Pass tested end-to-end against Rae-vs-Test throwaway game (✨ moved Rae→Test, no console errors). Submit/exchange/forfeit verified by structural inspection only (same code, just relocated; `submitting` state correctly disables Submit button when no placements). Pure copy-paste — no logic changes.

**Commit:** f8c4b96.

### Next: scaffold

Tomorrow's plan is the `templates/sq-game-starter/` scaffold (see project memory `project_sq_next_session.md`). Not started in this session.

### Session: 2026-04-29 — Hub-leftovers cleanup

Two pieces removed because the hub now owns them:

- **`IOSInstallPrompt.jsx` deleted** from `src/components/lobby/` and the `<IOSInstallPrompt />` render dropped from `LobbyPage.jsx`. Component moved to `rae-side-quest/src/components/IOSInstallPrompt.jsx` with copy adapted ("Install Rae's Side Quest", new dismiss key `sq-ios-install-dismissed`). Hub also gained a new `AndroidInstallPrompt` for Chromium `beforeinstallprompt`. See hub memory for details.
- **Cloudflare Turnstile fully removed.** `@marsidev/react-turnstile` dropped from `package.json` (lockfile regenerated, 1 package removed); `VITE_TURNSTILE_SITE_KEY` line removed from `.github/workflows/deploy.yml` and `.env.example`. The `CLOUDFLARE_CAPTCHA` GitHub secret on the Wordy repo was also deleted by Rae from Settings → Secrets. Hub repo (`Katinkabeat/games`) still uses Turnstile on its own auth page — leave that alone.

No source still references Turnstile (only the Scrabble dictionary at `public/words.txt` keeps `TURNSTILE`/`TURNSTILES` as legit playable words). Service worker has no `CACHE_VERSION` to bump — `public/sw.js` only handles push events.

**Commit:** `c22a165`.

### Session: 2026-05-03 — Completed-games banners showing wrong games

Rae reported her last 10 finished-game banners stopped showing in the lobby. After the first investigation showed `dismissed_at IS NULL` for all 15 most recent finished games in DB, removed the localStorage filter (commit `e71c311`). Banners reappeared — but they were Rae's *oldest* games (March Test/Dino era), not her recent multiplayer games.

**Real root cause:** Query in `useUnseenResults.jsx` used `.order('finished_at', { referencedTable: 'games', ascending: false })` on a joined column. PostgREST only sorts the embedded payload that way, not the parent rows. With `LIMIT 10` applied to unsorted parent rows (default order is by id/joined_at ascending), the query returned the 10 oldest qualifying rows. Client-side sort on line 25 then arranged those 10 oldest by finished_at desc — but they were still the wrong 10.

**Fix (commit `0459696`):** Query rewritten to use `games` as the parent table with `game_players!inner(...)` join filter. Order-by `finished_at` now sorts the rows we limit on. Also removed the `dismissed_at IS NULL` filter and the X dismiss button entirely — section now shows the 10 most recent finished games unconditionally.

**Commits:** `e71c311` (localStorage removal), `0459696` (query rewrite + dismiss removal).


### Session: 2026-05-03 — Invite-a-friend feature

Ports Snibble's friend-invite pattern to Wordy with Wordy-specific multiplayer twists.

**Schema (`wordy-invite-friend-migration.sql`, applied):**
- `games.invited_user_ids` (uuid[]) — multi-friend invite (Wordy supports up to 4 players)
- `games.expires_at` (timestamptz) — auto-set by `wordy_set_game_expiry` BEFORE-INSERT trigger; 24h for invited, 7d for open
- `games.cancelled_at` (timestamptz?) — set when creator manually cancels
- `'cancelled'` and `'expired'` added to status check constraint
- Read-RLS replaced — fully-invited games hidden from non-participants. "Fully invited" = cardinality(invited_user_ids) >= max_players-1, i.e. no unreserved slots
- INSERT-RLS on game_players replaced with reserved-slot check: a non-invitee can only join if (current_player_count + pending_invitee_count) < max_players. Invitees can always join.
- `wordy_cancel_game(p_game_id)` RPC — creator-only, blocked once any game_moves exist
- `wordy_auto_start_or_cancel_stale()` RPC — sweeps waiting games past expires_at; if 2+ players joined, flips to active with random first turn; else flips to cancelled
- AFTER-INSERT push trigger fires when invited_user_ids non-empty → POSTs to push-notification with type=`game_invited`

**Edge function (deployed):** new `game_invited` handler in push-notification — fans out one push per invitee with "{inviter} invited you to a Wordy game" body.

**Frontend:**
- `src/hooks/useFriends.js` — same shape as Snibble/Rungles
- `src/components/lobby/CreateGameSheet.jsx` (new) — toggle (Open/With friends), player count picker (2/3/4), search input, multi-select friend list with cap = max_players-1, dynamic copy reflecting remaining unreserved slots
- `src/lib/gameMutations.js` — `createGame` accepts `invitedUserIds` array; new `cancelGame` and `autoStartOrCancelStale` helpers
- `src/components/lobby/LobbyPage.jsx` — replaces inline create-card with sheet trigger; lazy-calls `autoStartOrCancelStale` on each load; new `pendingInviteeNames` lookup so creator's row can render "📨 Invited X, Y" subtext; bucket logic adds invitedToYou (bumps to top of list)
- `src/components/lobby/LobbyGameRow.jsx` — accepts `isInviteToMe` (amber row + "Accept" button), `pendingInviteeNames` (drives invite subtext on creator's rows), `onCancel` (✕ button on creator's waiting rows)

**Behavior:**
- Open game: anyone joins, max_players FCFS, auto-cancel at 7d
- Invited game with all slots reserved (e.g. 3-player + 2 invitees): private, only invitees + creator see it
- Invited game with unreserved slots (e.g. 4-player + 2 invitees): visible in open lobby, randos can fill the 1 unreserved slot
- 24h timeout: if 2+ players joined → auto-start; else auto-cancel

**URL gotcha:** Wordy's edge function is deployed at `/functions/v1/push-notification` (lowercase). Earlier had `Push-Notification` (capital) in the migration — fixed in DB and migration file.

**Verified in preview:** sheet opens with player count + Open mode; toggle to Friends mode shows correct friend list (Krispy/Onyi/snuggie); selecting 2 of 3 updates description to "Remaining 1 slot will fill from the open lobby"; button label updates to "Send invites (2 friends)"; ✕ Cancel game button appears on existing waiting game (1/2).


## 2026-05-04 — Tile rack cross-browser wrap fix

Firefox was wrapping the 7th tile to a new line because `flex-wrap` + fixed `w-10` (40px) tiles + Firefox's box-rendering quirks pushed total width past the container. Switched `TileRack.jsx` container from `flex … flex-wrap` to `grid grid-cols-7 max-w-[316px] mx-auto`, and tiles from `w-10` to `w-full min-w-0` so they fill the grid cell and gracefully scale down on viewports narrower than 316px. Same pattern applied to Rungles for consistency.

## 2026-05-04 — 4-player board cut off on short mobile viewports

Snuggie (Pixel) reported the bottom row of the board hidden behind the sticky action bar in 3-4 player games. The board sizes purely on viewport width, with no awareness of remaining vertical room — at 4 players the score chips wrap to two rows, eating ~70px, and on a Pixel with the URL bar visible the cumulative chrome pushed the board past the action bar.

Tried a height-aware cellSize clamp first; Rae rejected because the board is already small on mobile and shouldn't shrink further. Pivoted to trimming chrome instead, board cell size unchanged (still 25px on Pixel-width):

- `GamePage.jsx` action bar: outer `p-2` → `p-1.5`, inner `space-y-1.5` → `space-y-1`, shuffle row `py-2` → `py-0.5`
- `ScorePanel.jsx` mobile chips: `py-1` → `py-0.5`, wrapped row gap `gap-2` → `gap-x-2 gap-y-1`
- `rae-side-quest/packages/sq-ui/components/SQBoardShell.jsx` wide-mode mobile `gap-3 / py-3` → `gap-2 / py-2` (desktop unchanged so Wordy desktop + other wide-mode users like Rungles' future board games aren't affected on lg+)

Saved ~32px of vertical chrome. Verified in preview at 412×780 (48px gap to action bar) and 412×730 (22px gap, still no cutoff).

**Commits:** wordy `534df18`, rae-side-quest (sq-ui) `51d1d24`.

## 2026-05-04 — perf sweep: lobby subscription scoping + game-load batching

Rae reported general SQ slowness across all four apps. Two Wordy-side
fixes shipped as part of the platform-wide sweep:

**Lobby realtime narrowed (LobbyPage.jsx).** The lobby was subscribed
to every change on every games + game_players row in the database, so
every other player's move across the platform re-fetched + re-rendered
the lobby. Filters added:
```js
.on('postgres_changes', { event: '*', schema: 'public', table: 'games',
    filter: `created_by=eq.${user.id}` }, handleGameChange)
.on('postgres_changes', { event: '*', schema: 'public', table: 'game_players',
    filter: `user_id=eq.${user.id}` }, loadGames)
```
Channel name now per-user (`lobby-updates-${user.id}`). Trade-off:
other people's open games appearing in real-time is gone — they show
up via the existing 10s poll + visibility-change refresh. Urgent
events (your turn, opponent joined, finished match) still arrive
instantly via push notifications. Rae confirmed the trade-off is
acceptable. Commit `f32c4c4`.

**game_moves per-player score query batched (useGameData.js).** Was
firing N sequential Supabase queries (one per player) inside a
Promise.all to grab each player's last-move score. Now one batched
query with `.in('user_id', playerIds)` ordered DESC; first occurrence
of each user_id in the result is their most recent score. Drops total
queries per game load from 7 to 4 for a 4-player game. Commit `e9146f1`.

**Cross-cutting (rae-side-quest):** Added 5 perf indexes via
`sq_perf_indexes.sql` migration on `game_players(user_id)`,
`game_moves(user_id, created_at)`, plus the Rungles equivalents.
Applied to shared Supabase via `supabase db query --linked`.

## 2026-05-04 — perf: parallelize loadGame fetches

Rae reported submit feels slow. Traced the submit pipeline — the DB
writes already run in parallel and the heavy validation (word list)
caches after first use. The hot path was `loadGame({ force: true })`
called after every submit/pass/exchange in `useGameMutations.js`,
which was doing 3 sequential network rounds inside `useGameData.js`:
games → game_players → (lastMove + scores + profiles) in parallel.

Collapsed to 2 rounds: the first 4 queries (games, game_players,
last-move tiles, all-move scores) all only need `gameId` and now
fire together via one `Promise.all`. Profiles still happens in a
second round because it needs `user_ids` from the game_players
result. Net effect: one round-trip removed from every move. Commit
`10c7257`.

## Session: May 21, 2026

### Board layout versioning — non-copyrighted board for new games (c9)
Shipped per-game board layouts so we can replace Scrabble's trademarked
premium-square arrangement before going public, WITHOUT changing any board
already in play.

**Why:** Scrabble's exact TW/TL/DW/DL placement is trademarked (Hasbro/Mattel).
Raeban c9 blocked public launch on this. The multiplier *mechanic* is fine —
only the *arrangement* is the issue.

**New layout chosen — "Faithful Clipped" (version 2):** an original layout
engineered to MATCH Scrabble's gameplay spacing — no two premiums orthogonally
adjacent, and no short word (even 4 letters) can land on two word-multipliers —
while sharing almost no squares with Scrabble (12/60 exact) or Words With
Friends (4/60 exact). Same 8/16/12/24 premium counts + centre start, so scoring
strategy is preserved. Triple-Words sit just off the literal corners
("clipped corners"); Double-Words form an edge ring. ~80% of squares moved vs
Scrabble. Design exploration + all the rejected options live in
`docs/c9-board-layouts.html` (a self-contained mockup with a gameplay-fidelity
readout per layout).

**How it works (per-game version, not a global swap):**
- `games.board_layout_version INT NOT NULL DEFAULT 1` (migration:
  `board-layout-version-migration.sql`). Applied to the shared DB via the
  Supabase Management API query endpoint (direct DB host is IPv6-only and won't
  resolve from this box; psql failed, Management API worked). All 114 existing
  games backfilled to 1 = Scrabble, so in-progress games are untouched.
- `boardData.js`: `BONUS_MAP_V1` (Scrabble) + `BONUS_MAP_V2` (Clipped);
  `getBonusType(row, col, version = 1)`; exported `CURRENT_LAYOUT_VERSION = 2`.
- `gameMutations.createGame` stamps new games with `CURRENT_LAYOUT_VERSION`.
- Version threaded through render + scoring: `GamePage` → `ZoomableBoard` →
  `Board` (getBonusType), and `calculateScore(board, placements, words,
  layoutVersion)` in both `useGameMutations` (authoritative) and `GamePage`
  (live preview). Defaults to 1 everywhere if the field is missing.

**Verified:** logic test (now deleted) confirmed v1=Scrabble, v2=Clipped,
correct 8/16/12/24 counts for both, version-aware scoring (DW cell scores x2 in
v1, normal in v2), and legacy default = v1. Vite builds clean; app runs (auth
redirect fires, no console errors). NOT visually exercised in an authenticated
in-game board — that needs SQ-hub login; the render is a direct 1:1 of the
verified getBonusType map, identical to the verified mockup.

**Still open before public launch:** the card's IP sanity-check note still
applies; and only NEW games use v2. Commit `d23c5ab`.

### Blocked-user filtering in invite friend list (c124)

`useFriends` now fetches `user_blocks` (RLS exposes only rows where
`blocker = auth.uid()`) and filters those ids out before loading profiles, so
people you've blocked no longer show in the Create Game invite dropdown.
Game-side only, no DB change — mirrors the hub Friends view pattern.

Root cause: `block_user` only inserts into `user_blocks`; it does NOT remove the
friendship, so blocked friends leaked into the friends-only dropdown.

Scope: only removes people *you* blocked. Stopping someone who blocked *you*
from inviting you is server-side enforcement and out of scope — RLS won't expose
who blocked you anyway.

Verified at the data layer: simulated Rae's authenticated session in psql
(`SET ROLE authenticated` + jwt claims), temp-blocked a friend inside a
transaction, confirmed the friend dropped from the filtered result, rolled back
(no persisted change). Build clean. NOT exercised in-browser (Turnstile login,
no test creds). Byte-identical edit shipped to Rungles.

## Session: 2026-05-23 — Atomic play submission (half-committed move bug)

Onyi reported: played a 20pt word, got the old "couldn't save" toast, then the
word vanished from the board / her tiles were replaced / score kept the +20 /
turn never advanced.

**Root cause:** `submitWord` (and `confirmExchange`) did two independent
client-side UPDATEs (`games` + `game_players`) in a `Promise.all`. RLS forces
the split — a player may only update their own `game_players` row, so the two
tables can't be written in one client statement. When the `games` write failed
but the `game_players` write succeeded, the move half-committed: score+rack
saved, board+tile_bag+turn lost. The drawn tiles also duplicated (in the rack
AND still in the bag, since `games.tile_bag` never updated). The old "just
retry the same word" habit then re-validated against corrupt state.

NOT the SQErrorBoundary (c117) — that was Rae's first guess, but the boundary
never fired; this was a silent partial DB write.

**Fix:** two SECURITY DEFINER RPCs in `wordy-atomic-submit-play-migration.sql`
(applied to shared DB via pooler/psql) — `submit_play` and `submit_exchange` —
each does both table writes in one transaction. They `SELECT ... FOR UPDATE`
the games row and guard `status='active'` + `current_player_idx = caller's
player_index`, so a retry after a hidden success is rejected ("Not your turn")
instead of double-applying. `passTurn` was already a single-statement write, so
it was left alone. `useGameMutations.js` swapped both Promise.all blocks for the
RPC calls; `endgameFields` still used by `passTurn`.

**Verified at data layer** (all rolled back, no real data touched): happy path
updates both tables atomically (board/bag/turn + player score/rack, opponent
untouched); out-of-turn submit raises "Not your turn"; finished-game submit
raises "Game is not active". `npm run build` clean. Authed in-game flow not
E2E'd (no test creds).

**Live data — investigated + fixed.** The original report sounded like a fully
stuck game, but by the time I checked, Dino & Onyi's game (`e978d2d8`) had
self-reconciled: each later normal move recomputes board/rack/bag from current
state, so board, tiles, and turn were all consistent again (now Dino's turn, 7
moves in). The ONLY lingering artifact was a cumulative-score phantom — Onyi's
`game_players.score` was 89 but her recorded `game_moves` summed to 69 (exactly
the +20 word that never landed). An integrity scan (score vs sum-of-moves) of
all active games found this was the only phantom anywhere. Fixed with a one-row
`UPDATE game_players SET score = 69` (Rae approved, 2026-05-23). Lesson: this
bug's durable signature is a score/moves-sum mismatch, NOT tile counts — placed
tiles leave the rack+bag pool so `tiles_in_play <> 100` is normal.

## Session: 2026-05-24 — How to Play modal (c134)

Wordy was the only SQ game with no in-game rules. Added `src/components/HowToPlayModal.jsx`
(SQModal-based, matches Yahdle/Snibble's per-game pattern) covering Scrabble basics for
first-timers: 7-tile rack, draw/replenish, forming words (first word covers centre star,
rest connect crossword-style), tile point values, the 2 blanks (=0 pts), DL/TL/DW/TW bonus
squares, the 50-pt all-7-tiles bingo bonus, scoring, pass/swap/forfeit, 2-4 player async
turn flow, and endgame. Wired into the settings cog dropdown (`SettingsModal.jsx`, which is
actually `SettingsDropdown`) via a new "How to Play" row + `onHowToPlay` callback; modal
state lives in `LobbyPage.jsx`. No em dashes in the user-facing copy.

Verified as far as headless allows: app boots, login renders, all three changed modules
transform via Vite with no errors (SQModal import resolves), no console errors. The modal
itself sits behind SQ-hub login + a Cloudflare challenge, so the click-through (open/close)
was NOT exercised in-browser — Rae should confirm by opening ⚙️ → How to Play once.

Commit `fed20e6`. Push needed a rebase onto remote (origin had picked up the atomic-submit
work that was sitting as local WIP); rebased cleanly. NOTE: pre-existing local WIP
(memory/wordy.md edits) is parked in `git stash@{0}` — it was a parallel copy of the
atomic-submit session already on remote, so it was not auto-merged. Rae can `git stash drop`
it after a glance, or pop+reconcile if it holds anything unique.

## 2026-05-31 — Decline-invite + opt-in decline-notify (c167/c172)

Added a decline (x) button to incoming invites + `wordy_decline_invite` SECURITY DEFINER RPC (wordy-decline-invite-migration.sql). Decline removes the caller from invited_user_ids; multi-seat games stay waiting short-handed and only close when the last invitee bails (close_reason='Invite declined'). Phase 2 (wordy-decline-notify-migration.sql): when a decline strands the game the RPC net.http_post's an 'invite_declined' push to push-notification edge fn, gated by the new per-game 'invite_declined' notif topic (default OFF, opt-in in hub NotificationsPanel). Edge fn handles the type via sendIfOptedIn. Verified via rolled-back impersonation test (close + exactly-1-push + 3p-stays-waiting-0-push + default-OFF gating) + live smoke test on deployed fn (returns opted-out). Authed device-side push NOT E2E'd — Rae to confirm.

## Invite-expiry baseline (c151, 2026-06-01)
Adopted the SQ invite-expiry baseline (Yahdle c150 / scaffolder c152). `wordy-invite-expiry-v2-migration.sql` (applied to prod via pooler): friend window 1d→3d (open stays 7d); `wordy_auto_start_or_cancel_stale` <2 branch changed from silent `status='cancelled'` → `status='finished' + close_reason='no_other_players'` (reuses existing close_reason col; no finish_game → no stats; setting waiting→finished fires no triggers) + one `game_closed` push to the creator. The ≥2 short-handed auto-start is unchanged (rotation is client-side over joined players, already correct — max_players left alone). Edge fn `push-notification`: added `game_closed` type. Client: useUnseenResults + LobbyPage render closed games "🚫 Game closed / invite expired"; GamePage final banner + ScorePanel show greyed ✗ no-show chips (GamePage computes noShowIds = invited_user_ids minus seated). Commit c745a36.

## React #310 crash viewing any game — hooks-after-early-return (2026-06-01)
The c151 no-show work introduced a Rules-of-Hooks violation: the three `noShow*` hooks (`noShowIds` useMemo, `noShowNames` useState, the no-show-names useEffect) were declared in GamePage.jsx BELOW the loading-screen early-return guard. First render returns early (game still loading) → those hooks don't run; once data loads they do → React sees more hooks than the prior render → error #310, white-screen crash. Surfaced when viewing completed games from the lobby list, but by the bug's logic it crashed every /game/:id open after the c151 deploy. Fix: hoisted the three hooks above the early-return guard — pure reorder, zero logic change. Commit 5c4b1bb. Rae confirmed completed games render again on deployed site. Lesson: when adding hooks to GamePage, they must go above the `if (!game || !board ...) return` guard.

## 2026-06-06 — Claim-inactive-win, built from scratch (c153)
Wordy had NO claim feature and no activity tracking (the c153 card's repro blamed Wordy, but the desktop prompt Rae saw was actually Yahdle/Snibble). Built it: `wordy-claim-inactive-migration.sql` (applied to prod via pooler) adds `games.last_activity_at` (default now(); stamped in submit_play / submit_exchange — re-created verbatim + one line — and in the client-side pass UPDATE) and `claim_inactive_win(p_game_id)` SECURITY DEFINER. The RPC validates caller-is-participant, not-your-turn, and last_activity_at older than 7d, then reuses `forfeit_game(game, stalled_user)` so winner-flagging + record_game_result stay identical to a normal forfeit. Client: `claimInactiveWin` in gameMutations.js; GamePage computes `canClaim` (suppressed for bot/solo games) and renders a "🏆 Claim win (opponent inactive)" row in the cog settings dropdown (always reachable on mobile — the established bug was inline claim buttons sitting below the fold). Verified at the data layer with rolled-back impersonation tests: happy path (game→finished, idle player=forfeit_user_id, claimant is_winner) + both negative guards (fresh activity → "Opponent still has time"; current player → "It is your turn"). Authed 7-day click-through NOT E2E'd. Commit pushed; Wordy SW is push-only so no CACHE_VERSION.

## 2026-06-07 — Claim revision: always-visible greyed row + data-backfill bug (c153)
The claim never lit up on real stalled games because the migration's `last_activity_at DEFAULT NOW()` had reset EVERY existing game's idle clock to migration time. Backfilled `last_activity_at` from `MAX(game_moves.created_at)` on prod (7 rows; the 21d + 17d games became claimable). Going-forward writes were already correct. UI: per Rae, the claim row in the cog is now ALWAYS shown for an active human game and greyed out unless it's the opponent's turn AND idle 7+ days (split `claimVisible` from `canClaim` in GamePage; greying uses the new `disabled` prop on sq-ui's SQSettingsRow). Rae click-verified. Headless authed verification now possible too — see the central feedback_sq_verification_constraint memory.

## 2026-06-07 — Tuned Claudette down (c177)
Players reported Claudette scoring 500+ and winning feeling unattainable. Confirmed via a throwaway self-play sim (250 games): she averaged ~453/player, max ~687, ~3 bingos/game. Her profile in `src/lib/engine/evaluator.js` was maxed (`rank:'best', noise:0`). Nerfed her to `rank:'topK', topK:3, noise:0.03, bingoSkip:0.30` (kept `useEquity:true` + full vocabulary, so she stays "expert"). Added a reusable `bingoSkip` knob to `chooseMove`: with that probability the turn's pool drops bingos so she leans on a shorter play — believable weakness, no random blunders (the card's approach #2, combined with #1). Measured after: avg 453→400, max 687→569, bingos 3.07→1.59; still clearly above Merlin (~378 avg). Updated the one equity unit test that assumed `rank:'best'` to use rng 0.4 (dodges skip/noise, floors topK to index 0); 14/14 green. The `bot-move` edge fn imports this evaluator straight from `src/lib`, so move selection runs server-side — committed+pushed (5db9f1a) AND redeployed bot-move (`supabase functions deploy bot-move --project-ref yyhewndblruwxsrqzart`) for it to take effect. Quill changelog posted. Sim script was deleted (throwaway).

## 2026-06-07 — timeAgo moved to shared sq-ui helper (c186)
Deleted the two identical inline `timeAgo` defs (admin/AdminPanel.jsx + lobby/LobbyGameRow.jsx) and imported the new shared `timeAgo` from rae-side-quest/packages/sq-ui/index.js. Output is byte-identical to before — pure extract, no behavior change.

## 2026-06-11 — Game-end push on claim/forfeit (c188)
Wordy had no game-end push (on_turn_change only fires when status='active'). Added the unified SQ game-end contract — Wordy was built as the template. `games.end_reason` ('claim'|'forfeit'; NULL for normal completion + admin-close). `forfeit_game` gained a 3rd `p_reason` arg (default 'forfeit'; dropped the old 2-arg overload so PostgREST resolves cleanly); `claim_inactive_win` now calls `forfeit_game(game, stalled, 'claim')`. New `on_game_finished` trigger (AFTER UPDATE active→finished, WHEN end_reason IS NOT NULL) → pg_net type 'game_finished'. Edge fn `push-notification` got a `getUsername` helper + a `game_finished` handler: claim → push the LOSER ("<claimant> claimed the win because your turn was idle 7+ days."), forfeit → push the WINNER ("<forfeiter> forfeited, you win!"); skips bots, respects prefs (game_finished topic), admin-close stays silent (end_reason NULL → trigger doesn't fire). Migration `wordy-gameend-push-migration.sql` applied to prod via pooler; fn deployed. Verified end-to-end against a real game whose recipient had no push sub (both branches → {sent:false, no push subscription} = full path ran, nothing delivered).

## 2026-07-02 — Removed "← you" leaderboard self-marker (Rae request)
Dropped the "← you" text label (Wordy: "(you)") from the leaderboard row in StatsPage. The `isYou`/`isMe` prop still drives the row highlight (bg-white/15 ring) — only the redundant text was removed. In-match "(you)" during live games left as-is (not a leaderboard). No Quill post (Rae's call, too small).

## 2026-07-07 — Nudge push failures now surfaced (c239)
The nudge push was fire-and-forget (`.catch(() => {})` / warn-only), so a dropped POST left the nudger with a false "Reminder sent!" toast. Now the handler awaits the push, checks `res.ok`, and on a non-2xx or network error surfaces a failure toast instead of success (plus `console.warn`). Added an 8s `AbortController` cap so a hung edge fn can't spin the nudge button forever. Failure leaves the button available to retry.
Known limit (unchanged, out of scope): the RPC/update stamps `last_nudged_at` *before* the push, so a retry within 12h is still cooldown-blocked server-side. Verified: all four games build clean + boot; the failure toast itself needs an authed >12h-stale match to click (hub-login bounce = known authed-verify wall).

## 2026-07-09 — finish_game stamp hardened (fire-and-forget → resilient) (SQ audit, c254 sibling)
Cross-game audit follow-up after the Oublex silent-write bug. Wordy's game-over path has TWO writes: the critical state flip (`submit_play`, sets `status='finished'`) is already awaited with an error toast + `recall()`, so the game is never stuck/replayable. But the `finish_game` RPC (final winner flag + scores + `player_matchups` leaderboard stats) was fire-and-forget (`callFinishGameRpc`, `useGameMutations.js` — called unawaited from submitWord/passTurn/confirmExchange with `console.error`-only). A stale-token 401 (backgrounded mobile tab) silently dropped the win record + leaderboard stamp while the game still showed finished.
- **Fix:** `callFinishGameRpc` is now `async` with a 3-try loop that `console.error`s + `supabase.auth.refreshSession()` + backs off between attempts, so the stamp self-heals on a stale token. Still called unawaited from the flow (correct — the game-finished status is set atomically inside `submit_play`; this is a background record). No UI save-state added: unlike the solo dailies, the MP game-over surface is the authoritative game state itself, which is already correct; only the background win/leaderboard stamp needed resilience. Commit `0594e0d`.
- **Verified:** `npm run build` clean, AND driven at runtime (preview + service_role session-injection): seeded a 2-player active game one pass from over (consecutive_passes=3), injected player A's session, double-tap Pass → "Game over" → `callFinishGameRpc` → `finish_game` landed: `games.status='finished'`, `game_players.is_winner` set (A won 19–14 after rack-value subtraction), and `player_matchups` written (A 1-0, B 0-1). Success path runs through the modified async `callFinishGameRpc` (recorded on attempt 1). The finish_game-specific 401→refresh→retry can't be isolated cleanly (passTurn's own games-UPDATE uses the same token and would 401 first, with a visible "Failed to pass" toast — not a silent loss), so that limb rests on the same mechanism proven live in Yahdle. Test data cleaned up. Wordy's SW is push-only (no fetch/caches) so no cache bump.
- Completes the write-resilience audit: Oublex (c254), Rungles (`cfcf274`), Yahdle (`9929319`), Wordy (`0594e0d`). Snibble deliberately skipped (incremental banking already self-heals). See [[feedback_sq_result_write_resilience]].

## 2026-07-10 — Nudge + player_joined pushes were 404ing (capitalized fn URL)
Rae nudged Dino in Wordy and got "Failed to send reminder". Root cause: the two **client-initiated** pushes POSTed to `/functions/v1/Push-Notification` (capital P/N) while the function is deployed lowercase. Supabase's function router is case-sensitive → `{"code":"NOT_FOUND"}`, HTTP 404. Probed both casings against prod to confirm. This is the exact gotcha already noted under "URL gotcha" above — it was fixed in the SQL migrations back then but **never in the JS call sites**, so the DB-webhook pushes (turn_change, game_invited, game_finished) worked while the client ones never did.
- **`sendNudge`** (`LobbyGameRow.jsx`) — awaits the POST since c239, so it correctly surfaced the failure. Before c239 it swallowed the error and always toasted "🔔 Reminder sent!", which is why this went unnoticed for so long.
- **`player_joined`** (`gameMutations.js`) — still fire-and-forget, no toast, no error check. **Nobody has ever been notified when someone joined their Wordy game.** Same bug class c239 was written to catch; that card only scoped the nudge call site.
- Grepped all 5 SQ apps for `functions/v1/[A-Z]`: **only Wordy**, only these 2 lines.

**Also fixed (c248's cooldown-on-success, ported from Yahdle):** `sendNudge` stamped `games.last_nudged_at` *before* the push, so the 404 still burned the 12h cooldown and hid the bell — Rae couldn't retry. Now the stamp happens only after `res.ok`. A failed *stamp* `console.warn`s instead of throwing, since the push landing is what "sent" means (a stamp error must not produce a false "Failed to send" after a real delivery). Wordy has a direct UPDATE policy on `games`, so no RPC needed (unlike Yahdle's `yahdle_mark_nudged`).

**Verified:** 404-vs-200 probe on both casings; real nudge delivered to Dino end-to-end (`{"sent":true,"via":"sidequest"}`) via the exact client payload; his `push_subscriptions` row + `sq_notification_enabled(uid,'wordy','nudge')=true` confirmed healthy, so the URL was the only fault. Cleared the stale `last_nudged_at` on game `607aea1c` so the bell returns. Build clean; app loads with no console errors. Bell click is the authed boundary (per [[feedback_sq_verification_constraint]]) — not click-tested. Commit `60e86cf`.

**Note for c259** (hide bell for opted-out opponents): `sendNudge` moved underneath it. Also relevant — the edge fn returns **HTTP 200 with `{"sent":false,"reason":"opted out"}`**, so `res.ok` is true and the client toasts success + stamps cooldown even when nothing was delivered. c259's client-side prefs gate is what prevents that path being reachable; the toast itself still can't distinguish delivered from skipped.

## 2026-07-10 — Nudge bell gated on the opponent's opt-in + toast now reads `sent` (c259)
Generalised c248 (which shipped Yahdle-only) to all four games, and closed the hole c260 left open.

**Two changes, one invariant: never claim a nudge was sent unless a notification was actually delivered.**
1. **Bell gate.** The 🔔 only renders when the recipient has that game's `nudge` topic enabled (`sq_notification_enabled(uid, app, 'nudge')`). Fail-open: an RPC/transport error returns `true`, so a hiccup in a courtesy check never hides a bell that would have worked (the server re-checks the same pref anyway).
2. **Delivery check.** The push edge functions answer **HTTP 200** with `{sent:false, reason:'opted out'|'no push subscription'}` or `{skipped:'…'}`. `res.ok` therefore proves *nothing*. All four call sites now read the body and treat `sent !== true` as a failure. An unparseable 200 counts as delivered (fail-open — a false "couldn't send" on a nudge that landed is worse).

`no push subscription` is the common case, not `opted out`: a player with the pref ON who never granted browser permission. The bell gate does NOT catch that one — only the `sent` read does.

**Shared helper.** `rae-side-quest/packages/sq-ui/utils/nudge.js` — `isNudgeEnabled(supabase, userId, app)`, `postNudge({url, anonKey, body})` → `{delivered, reason, status}`, `nudgeFailureMessage(reason)`. sq-ui carries no deps, so the **caller passes its own supabase client**. Non-React lib files import `utils/nudge.js` directly (not the package index) so they don't drag the JSX components into their chunk. Games consume sq-ui by relative path, so no install step.

Failure copy never names the recipient's notification settings — "They're not set up to get reminders right now." Their prefs are their business, not the nudger's.

**Verified:** probed the four *live* edge fns with a bogus game id — all returned **200 + `{skipped}`**, i.e. the old `res.ok` code would have toasted "Reminder sent!" for a nudge that never left the server. Stubbed the remaining body shapes (`sent:true`, both `sent:false` reasons, 404, unparseable, network error) — all classify correctly. Gate proven at the data layer in a rolled-back txn against a real account: per-topic off → bell hides for that game only; back on → returns; per-app `_master` off → hides; global `_all/_master` off → hides everywhere. Vite `@fs` resolution of the new cross-package import confirmed 200 in all four dev servers. All four build clean. Bell click stays the authed boundary ([[feedback_sq_verification_constraint]]).
**Wordy specifics:** `LobbyGameRow.jsx` is per-row, so it fetches the one current player's pref in a `useEffect` (no fan-out Map) — gated on `nudgeEligible` first, so most rows never make the call. `nudgeAllowed === null` (not loaded) keeps the bell hidden. `canNudge` split into `nudgeEligible` (clock/turn) + the pref. Cooldown still stamps only after a confirmed delivery (c260). Commit `e6a1043`.

## 2026-07-11 — Push address refresh-on-play + address-death alarm (c270 / c268)
Part of the platform-wide notification-reliability stack (watch card c269). Two changes landed in this game:
1. **Refresh-on-play (A1, c270):** `main.jsx` now calls `installPushHeal()` (from sq-ui) after `installGlobalErrorReporting`. It injects a hidden `/games/?heal=1` iframe — guarded by `Notification.permission==='granted'` (never prompts), once/session — that runs in the HUB service-worker scope and re-subscribes the shared `sidequest` push address while the user just plays. Closes the old "only heals on hub-open" gap for players who live in one game tab. The heal logic lives in the hub (`HealFrame.jsx` + `pushNotifications.ensurePushSubscribed`); this game only embeds the frame. All SQ apps are same-origin under `katinkabeat.github.io`, so the iframe shares localStorage + session.
2. **Address-death alarm (c268):** the push edge fn's 410/404→delete branch (`sendPushToUser`) now calls `reportAddressDeath` → posts a low-noise FYI to #error-log (game/user/topic/endpoint-host, as Rook) so a dead push address is no longer silent. `topic` threaded through `sendIfOptedIn → sendPushToUser`.
**Wordy SW:** push-only, no app-shell cache → no CACHE_VERSION bump. Push fn: `supabase/functions/push-notification/index.ts`. Deployed + smoke-tested 200. Commits: main.jsx + push fn pushed to main.

## 2026-07-16 — Pass-out only ends the game when the bag is empty (c289)
Rule change off the c287 win-trading discussion: **consecutive passes (2× per player) only end the game once the tile bag is empty** — a true endgame stalemate. Kills the pass-out farm (one word + four passes ≈ 100 pts; mutual 0–0 pass-out paid both players) at the mechanic. Mid-bag quitters use Forfeit or the 7-day claim instead (Rae-blessed trade-off).

**Server-side enforcement** (`wordy-pass-out-bag-empty-migration.sql`, applied to shared project):
- New `submit_pass(p_game_id, p_user_id) RETURNS BOOLEAN` — full atomic-move shape (c157 caller guard w/ service_role exemption, row lock, turn/status checks). Increments the counter, advances the turn **server-side** (`(idx+1) % player_count`), bumps `last_activity_at`, decides game-over with the bag-empty condition, returns it.
- `submit_exchange` recreated same-signature but **`p_is_game_over` is now ignored** — over computed server-side. An exchange returns tiles to the bag, so it can never be the ending move; the param survives only for deployed-client compat.

**Callers:** `passTurn()` now calls the RPC (direct `games` UPDATE + client `endgameFields()` deleted); bot-move's pass branch switched from its service-role direct UPDATE to the same RPC — which also fixes the bot pass never bumping `last_activity_at`. `isGameOver()` pass branch + client exchange expression now include bag-empty. How-to-play "Ending the game" gained the stalemate sentence. bot-move redeployed.

**Verified:** rolled-back psql txn against the live schema (service_role via `set_config('request.jwt.claims',…)`): 4th pass mid-bag → `f`/active/counter 4/turn advanced; empty-bag pass past threshold → `t`/finished/`finished_at` set; pass on finished game rejected; exchange claiming `p_is_game_over=TRUE` with a non-empty bag stays active. Build clean, dev app boots with zero console errors; the pass click itself is behind auth (per [[feedback_sq_verification_constraint]]). Commit `71cca35`; Quill posted.

**Deploy-window note:** clients running the pre-71cca35 bundle still end games client-side via the old direct UPDATE until GH Pages refreshes — RLS still allows participant UPDATEs on `games`. If that path ever gets locked down, `submit_pass` is the only pass writer.

**Post-ship (same evening):** Rae's still-cached pre-deploy bundle pass-ended a Rae-vs-Test game mid-bag (`aceda922`, 82 tiles left) before she reloaded — exactly the deploy-window path noted above. Cleanup recipe for erasing a finished test game entirely: `DELETE game_moves → game_players → games` for the game id, then decrement `player_matchups` **both directions** (winner's `wins`, loser's `losses`); leaderboard needs no touch — `get_leaderboard()` recomputes from `game_players` over finished games. After reload she re-tested live: mid-bag pass-back-and-forth would not end the game — the authed pass click (the one inch psql couldn't cover) is confirmed in the wild.
