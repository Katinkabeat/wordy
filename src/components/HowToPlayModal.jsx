import { SQModal } from '../../../rae-side-quest/packages/sq-ui/index.js'

export default function HowToPlayModal({ open, onClose }) {
  return (
    <SQModal open={open} onClose={onClose} title="How to play Wordy">
      <div className="space-y-3 text-sm leading-relaxed">

        <section>
          <h3 className="font-display text-base text-wordy-700 mb-1">The goal</h3>
          <p>
            Wordy is a multiplayer word game. Build words on the board from the
            letter tiles in your rack and rack up the highest score. New to word
            tile games? Start here.
          </p>
        </section>

        <section>
          <h3 className="font-display text-base text-wordy-700 mb-1">Your rack</h3>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>You hold <b>7 tiles</b>, hidden from the other players.</li>
            <li>
              Each tile shows a letter and its point value in the corner.
            </li>
            <li>
              After every turn you draw back up to 7 from the shared tile bag,
              so your rack refills as you play.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="font-display text-base text-wordy-700 mb-1">Making a word</h3>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              Place tiles in a single row or column to spell a word, then tap
              <b> Play</b>.
            </li>
            <li>
              The very first word of the game must cover the centre star ⭐.
            </li>
            <li>
              After that, every new word has to connect to tiles already on the
              board, crossword style.
            </li>
            <li>
              Any new words you create alongside your main word all count too.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="font-display text-base text-wordy-700 mb-1">Tile values</h3>
          <p className="mb-1.5">
            Common letters are worth the least, rare ones the most:
          </p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li><b>1 pt</b>: A, E, I, O, U, L, N, R, S, T</li>
            <li><b>2 pts</b>: D, G</li>
            <li><b>3 pts</b>: B, C, M, P</li>
            <li><b>4 pts</b>: F, H, V, W, Y</li>
            <li><b>5 pts</b>: K</li>
            <li><b>8 pts</b>: J, X</li>
            <li><b>10 pts</b>: Q, Z</li>
          </ul>
        </section>

        <section>
          <h3 className="font-display text-base text-wordy-700 mb-1">Blank tiles</h3>
          <p>
            There are <b>2 blank tiles</b> in the bag. A blank can stand in for
            any letter you choose when you play it, but it is always worth
            <b> 0 points</b>.
          </p>
        </section>

        <section>
          <h3 className="font-display text-base text-wordy-700 mb-1">Bonus squares</h3>
          <p className="mb-1.5">Coloured squares boost your score, but only the turn a tile first lands on them:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><b>DL</b> doubles that letter's value.</li>
            <li><b>TL</b> triples that letter's value.</li>
            <li><b>DW</b> doubles the whole word's value.</li>
            <li><b>TW</b> triples the whole word's value.</li>
            <li>The centre star counts as a double word square.</li>
          </ul>
        </section>

        <section>
          <h3 className="font-display text-base text-wordy-700 mb-1">Scoring</h3>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              Add up the tile values, applying any letter bonuses first, then
              the word bonuses.
            </li>
            <li>
              Use <b>all 7 of your tiles</b> in one turn for a <b>50 point</b>
              bingo bonus on top.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="font-display text-base text-wordy-700 mb-1">Pass, swap, forfeit</h3>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <b>Pass</b> if you can't or don't want to play. Your turn ends with
              no score.
            </li>
            <li>
              <b>Swap</b> to trade unwanted tiles back into the bag for fresh
              ones. This uses your whole turn.
            </li>
            <li>
              <b>Forfeit</b> to bow out of the game entirely. The other players
              carry on without you.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="font-display text-base text-wordy-700 mb-1">Taking turns</h3>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              Wordy is for <b>2 to 4 players</b> and runs turn by turn, so there
              is no rush. Play when it suits you and the next player goes after.
            </li>
            <li>
              When it's your move, Wordy makes it clear and the board unlocks for
              you. Otherwise you're waiting on someone else.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="font-display text-base text-wordy-700 mb-1">Ending the game</h3>
          <p>
            The game ends when the bag is empty and one player uses their last
            tile. That player earns a bonus from everyone else's leftover tiles,
            while the rest lose the value of the tiles still on their racks.
            Highest score wins.
          </p>
        </section>

      </div>
    </SQModal>
  )
}
