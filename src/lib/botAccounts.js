// ────────────────────────────────────────────────────────────
//  The four computer-player accounts.
//
//  Each bot is a real auth.users row with a FIXED id, so difficulty
//  is derived from the account id — no per-seat column needed. These
//  same ids are seeded by wordy-bots-migration.sql.
//
//  Shared (pure ESM) by the React client and the bot-move edge fn.
// ────────────────────────────────────────────────────────────

export const BOT_ACCOUNTS = [
  { characterId: 'robin', id: 'b0700001-0000-4000-8000-000000000001', name: 'Robin', avatarHue: 145 },
  { characterId: 'jay', id: 'b0700002-0000-4000-8000-000000000002', name: 'Jay', avatarHue: 210 },
  { characterId: 'merlin', id: 'b0700003-0000-4000-8000-000000000003', name: 'Merlin', avatarHue: 25 },
  { characterId: 'claudette', id: 'b0700004-0000-4000-8000-000000000004', name: 'Claudette', avatarHue: 320 },
]

export const BOT_ID_BY_CHARACTER = Object.fromEntries(BOT_ACCOUNTS.map(b => [b.characterId, b.id]))
export const CHARACTER_BY_BOT_ID = Object.fromEntries(BOT_ACCOUNTS.map(b => [b.id, b.characterId]))

export function isBotId(id) {
  return Object.prototype.hasOwnProperty.call(CHARACTER_BY_BOT_ID, id)
}
