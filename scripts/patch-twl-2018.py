"""
Patch public/words.txt with the 2018 TWL additions that the current
list (pre-2018 TWL) is missing. Idempotent: re-running is a no-op.
"""
from pathlib import Path

ADDITIONS = """
OK OKS
EW EWS
BAE BAES
BESTIE BESTIES
EMOJI EMOJIS
FACEPALM FACEPALMS FACEPALMED FACEPALMING
FROWNY
HANGRY
TWERK TWERKS TWERKED TWERKING
ARANCINI
BIBIMBAP BIBIMBAPS
BIZJET BIZJETS
CAKEY
CHILLAX CHILLAXES CHILLAXED CHILLAXING
PUGGLE PUGGLES
QAJAQ QAJAQS
QUINZHEE QUINZHEES
SCHMUTZ SCHMUTZES
SCHNEID SCHNEIDS
SCOOCH SCOOCHES SCOOCHED SCOOCHING
SHEEPLE
SRIRACHA SRIRACHAS
WAGYU WAGYUS
YOWZA YOWZAS
ZEN ZENS
ZOMBOID ZOMBOIDS
"""

path = Path(__file__).resolve().parent.parent / "public" / "words.txt"
existing = set(w.strip() for w in path.read_text().splitlines() if w.strip())

new_words = set()
for line in ADDITIONS.strip().splitlines():
    for w in line.split():
        new_words.add(w.upper())

added = sorted(new_words - existing)
already = sorted(new_words & existing)

merged = sorted(existing | new_words)
path.write_text("\n".join(merged) + "\n")

print(f"Added {len(added)} new words:")
for w in added:
    print(f"  + {w}")
print(f"\nAlready present ({len(already)}): {', '.join(already)}")
print(f"\nNew total: {len(merged)} words")
