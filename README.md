# 🟣 Wordy — The Cute Word Game for Friends

A Scrabble-inspired multiplayer word game with a purple theme, real-time play,
and win tracking. Built with React + Supabase + GitHub Pages.

---

## ✨ Features
- Full Scrabble rules (15×15 board, bonus squares, standard tile bag)
- 2–4 players per game
- Real-time turn-based play (live updates — no refresh needed!)
- Async fallback — resume any time if someone disconnects
- User accounts with passwords
- Win/loss stats per friend matchup
- Purple & cute design 🌸

---

## 🚀 Setup Guide (Step by Step)

> **You'll need:**
> - A free [GitHub](https://github.com) account
> - A free [Supabase](https://supabase.com) account
> - [Node.js](https://nodejs.org) installed on your computer (v18+)
> - [Git](https://git-scm.com) installed

---

### STEP 1 — Create your Supabase project

1. Go to [https://supabase.com](https://supabase.com) and sign up for free.
2. Click **"New project"**, give it the name `wordy`, choose a region near you,
   and set a database password (save this somewhere safe).
3. Wait about 2 minutes for the project to be ready.

---

### STEP 2 — Set up the database

1. In your Supabase project, click **"SQL Editor"** in the left sidebar.
2. Click **"+ New query"**.
3. Open the file `supabase-schema.sql` from this project folder.
4. Copy **all** the contents and paste them into the SQL editor.
5. Click **"Run"** (or press Ctrl+Enter / Cmd+Enter).
6. You should see "Success" — the database is ready!

---

### STEP 3 — Get your Supabase API keys

1. In Supabase, click **"Settings"** (gear icon) → **"API"**.
2. Copy two values:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon / public key** — a long string of letters and numbers
3. Keep these ready for the next step.

---

### STEP 4 — Create a GitHub repository

1. Go to [https://github.com/new](https://github.com/new).
2. Name it **`wordy`** (lowercase, exact spelling matters!).
3. Make it **Public** (GitHub Pages requires this on the free plan).
4. Click **"Create repository"** — don't add any files yet.

---

### STEP 5 — Add your secrets to GitHub

This keeps your Supabase keys private so they're never visible in your code.

1. In your new GitHub repo, click **Settings** → **Secrets and variables** → **Actions**.
2. Click **"New repository secret"** and add these two secrets:

   | Name | Value |
   |------|-------|
   | `VITE_SUPABASE_URL` | Your Supabase Project URL |
   | `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key |

---

### STEP 6 — Enable GitHub Pages

1. Still in your repo's **Settings**, click **"Pages"** in the left sidebar.
2. Under **"Source"**, select **"GitHub Actions"** from the dropdown.
3. Click **Save**.

---

### STEP 7 — Push the code to GitHub

Open a terminal / command prompt and run these commands one at a time:

```bash
# Navigate into the wordy folder
cd path/to/wordy

# Install dependencies
npm install

# Initialise git and push to GitHub
git init
git add .
git commit -m "Initial Wordy release 🟣"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/wordy.git
git push -u origin main
```

> Replace `YOUR-USERNAME` with your actual GitHub username!

---

### STEP 8 — Wait for deployment (~2 minutes)

1. Go to your GitHub repo and click the **"Actions"** tab.
2. You'll see a workflow called "Deploy Wordy to GitHub Pages" running.
3. Once it shows a green ✅ tick, your game is live!

---

### STEP 9 — Visit your game!

Your game will be live at:
```
https://YOUR-USERNAME.github.io/wordy/
```

Share this link with your friends and start playing! 🎉

---

## 🎮 How to Play

1. **Register** an account with your email and a username.
2. From the **Lobby**, click **"Create Game"** and choose how many players (2–4).
3. Share the lobby link with your friends — they can **Join** your open game.
4. Once everyone has joined, the game starts automatically.
5. **Click a tile** in your rack to select it (it lifts up with a pink ring).
6. **Click a cell** on the board to place it.
7. Place all your tiles for the word, then click **"✅ Submit Word"**.
8. Words are validated automatically against the English dictionary.
9. Use **↩ Recall** to take back placed tiles, **🔄 Exchange** to swap tiles,
   or **⏩ Pass** to skip your turn.
10. The game ends when a player empties their rack (and the bag is empty),
    or all players pass consecutively.
11. Check **📊 Stats** to see your win record vs each friend!

---

## 🃏 Tile Key

| Square | Colour | Meaning |
|--------|--------|---------|
| TW | Red | Triple Word Score |
| DW | Orange | Double Word Score |
| TL | Blue | Triple Letter Score |
| DL | Cyan | Double Letter Score |
| ★ | Pink | Centre square (first word must cover this) |

---

## 🔒 Security Notes

- **Never** share your Supabase secret key (the one labelled "service_role").
  The app only uses the **anon key**, which is safe to use in a browser.
- Your GitHub repository is public (required for free Pages hosting), but your
  API keys are stored as private GitHub Secrets — they are **never** visible in
  the code.
- Supabase Row Level Security (RLS) ensures players can only modify their own
  data and the games they're participating in.

---

## 🛠 Local Development (optional)

If you want to test changes on your own computer before publishing:

```bash
# Create a .env file with your Supabase keys
cp .env.example .env
# Edit .env and fill in your keys

# Start the local dev server
npm run dev
# Visit http://localhost:5173/wordy/
```

---

## 📁 Project Structure

```
wordy/
├── src/
│   ├── components/
│   │   ├── auth/          # Login & registration page
│   │   ├── lobby/         # Game list, create/join games
│   │   ├── game/          # Board, tiles, scoring, game logic
│   │   └── stats/         # Win/loss stats per player
│   ├── lib/
│   │   ├── supabase.js    # Database connection
│   │   ├── tileData.js    # Letter values & tile bag
│   │   ├── boardData.js   # Bonus squares & board structure
│   │   ├── gameLogic.js   # Validation, scoring, game over
│   │   └── wordValidator.js # Dictionary API integration
│   └── App.jsx            # Routing
├── supabase-schema.sql    # Run this once in Supabase
└── .github/workflows/     # Auto-deploys on every push to main
```

---

Made with 💜 and a lot of tiles.
