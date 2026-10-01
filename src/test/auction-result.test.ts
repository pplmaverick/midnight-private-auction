import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeAuctionResult, computePublicResult, type AuctionResultInput } from '../../frontend/src/midnight/auctionResult.js';
import {
  shouldShowActionsPanel,
  canShowRevealButton,
  isRevealWindowOpen,
  type ActionsPanelInput,
} from '../../frontend/src/midnight/auctionActions.js';
import { describeMyOutcome, NOT_COUNTED_TEXT } from '../../frontend/src/midnight/resultCopy.js';

// Pure result logic (frontend/src/midnight/auctionResult.ts): no wasm, no network.

const pk = (n: number): Uint8Array => new Uint8Array(32).fill(n);
const PK_A = pk(1);
const PK_B = pk(2);
const PK_C = pk(3);
const PK_OTHER = pk(9);

const DEADLINE = 1_000n;
const AFTER = DEADLINE + 1n;
const BEFORE = DEADLINE - 1n;

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const setOf = (...pks: Uint8Array[]) => new Set(pks.map(hex));

// Builds an input for a CLOSED auction; override only what a test cares about.
const input = (o: {
  nowSec?: bigint;
  isClosed?: boolean;
  highestBid?: bigint;
  highestBidderPK?: Uint8Array | null;
  myPKs?: readonly Uint8Array[] | null;
  sealed?: Uint8Array[];
  revealed?: Uint8Array[];
}): AuctionResultInput => {
  const sealed = setOf(...(o.sealed ?? []));
  const revealed = setOf(...(o.revealed ?? []));
  return {
    isClosed: o.isClosed ?? true,
    nowSec: o.nowSec ?? AFTER,
    revealDeadline: DEADLINE,
    highestBid: o.highestBid ?? 0n,
    highestBidderPK: o.highestBidderPK ?? null,
    myPKs: o.myPKs === undefined ? [PK_A] : o.myPKs,
    isSealed: (p) => sealed.has(hex(p)),
    isRevealed: (p) => revealed.has(hex(p)),
  };
};

describe('computeAuctionResult — my outcome once finalized', () => {
  it('winner: my revealed bid is the highest', () => {
    const r = computeAuctionResult(
      input({ highestBid: 150n, highestBidderPK: PK_A, sealed: [PK_A, PK_OTHER], revealed: [PK_A, PK_OTHER] }),
    );
    expect(r.finalized).toBe(true);
    expect(r.sold).toBe(true);
    expect(r.highestBid).toBe(150n);
    expect(r.me).toBe('winner');
  });

  it('revealed but not the winner: someone else holds the highest bid', () => {
    const r = computeAuctionResult(
      input({ highestBid: 200n, highestBidderPK: PK_OTHER, sealed: [PK_A, PK_OTHER], revealed: [PK_A, PK_OTHER] }),
    );
    expect(r.me).toBe('revealed-not-winner');
    expect(r.highestBid).toBe(200n);
  });

  it('sealed a bid but never revealed it: abstained (even if someone else won)', () => {
    const r = computeAuctionResult(
      input({ highestBid: 200n, highestBidderPK: PK_OTHER, sealed: [PK_A, PK_OTHER], revealed: [PK_OTHER] }),
    );
    expect(r.me).toBe('abstained');
  });

  it('no sealed bid from this wallet: no-bid, and the public result is still reported', () => {
    const r = computeAuctionResult(
      input({ highestBid: 200n, highestBidderPK: PK_OTHER, sealed: [PK_OTHER], revealed: [PK_OTHER] }),
    );
    expect(r.me).toBe('no-bid');
    expect(r.sold).toBe(true);
    expect(r.highestBid).toBe(200n);
  });

  it('highestBid = 0 (nobody revealed): finalized but not sold, nobody is the winner', () => {
    const r = computeAuctionResult(input({ highestBid: 0n, sealed: [PK_A], revealed: [] }));
    expect(r.finalized).toBe(true);
    expect(r.sold).toBe(false);
    expect(r.me).toBe('abstained');
  });

  it('highestBid = 0 with my 0-value reveal: revealed-not-winner, never winner', () => {
    // highestBidderPK is the zero default; even a stale match must not make me "winner".
    const r = computeAuctionResult(input({ highestBid: 0n, highestBidderPK: PK_A, sealed: [PK_A], revealed: [PK_A] }));
    expect(r.sold).toBe(false);
    expect(r.me).toBe('revealed-not-winner');
  });
});

describe('computeAuctionResult — reveal window still open (not final)', () => {
  it('is not finalized before revealDeadline: highest bid is only "current", never a winning bid', () => {
    const r = computeAuctionResult(
      input({ nowSec: BEFORE, highestBid: 150n, highestBidderPK: PK_A, sealed: [PK_A], revealed: [PK_A] }),
    );
    expect(r.finalized).toBe(false);
    expect(r.revealWindowOpen).toBe(true);
    expect(r.sold).toBe(false);
    expect(r.highestBid).toBe(150n);
    // leading right now is NOT "winner" until the window closes
    expect(r.me).toBe('revealed-pending');
  });

  it('sealed but not yet revealed, window open: sealed-pending (not abstained yet)', () => {
    const r = computeAuctionResult(input({ nowSec: BEFORE, sealed: [PK_A], revealed: [] }));
    expect(r.me).toBe('sealed-pending');
  });

  it('no bid from this wallet during the window: no-bid', () => {
    expect(computeAuctionResult(input({ nowSec: BEFORE, sealed: [PK_OTHER] })).me).toBe('no-bid');
  });

  it('boundary: nowSec == revealDeadline is final (contract: claim/finalize use blockTime >= deadline)', () => {
    expect(computePublicResult({ isClosed: true, nowSec: DEADLINE, revealDeadline: DEADLINE, highestBid: 5n }).finalized).toBe(true);
    expect(computePublicResult({ isClosed: true, nowSec: BEFORE, revealDeadline: DEADLINE, highestBid: 5n }).finalized).toBe(false);
  });

  it('a BIDDING (not closed) auction is never finalized, whatever the clock says', () => {
    const r = computeAuctionResult(input({ isClosed: false, nowSec: AFTER + 10_000n, highestBid: 0n, sealed: [PK_A] }));
    expect(r.finalized).toBe(false);
    expect(r.revealWindowOpen).toBe(false);
    expect(r.sold).toBe(false);
  });
});

describe('computeAuctionResult — multiple candidate PKs', () => {
  it('any candidate that is the highest bidder makes me the winner', () => {
    const r = computeAuctionResult(
      input({ myPKs: [PK_A, PK_B, PK_C], highestBid: 300n, highestBidderPK: PK_C, sealed: [PK_C], revealed: [PK_C] }),
    );
    expect(r.me).toBe('winner');
  });

  it('only the candidate that actually bid counts for sealed / revealed', () => {
    const r = computeAuctionResult(
      input({ myPKs: [PK_A, PK_B], highestBid: 300n, highestBidderPK: PK_OTHER, sealed: [PK_B, PK_OTHER], revealed: [PK_B, PK_OTHER] }),
    );
    expect(r.me).toBe('revealed-not-winner');
  });

  it('candidates with no sealed bid at all: no-bid', () => {
    expect(computeAuctionResult(input({ myPKs: [PK_A, PK_B, PK_C], sealed: [PK_OTHER] })).me).toBe('no-bid');
  });
});

describe('computeAuctionResult — no PK (wallet not connected)', () => {
  it('myPKs = null: unknown, public result still reported', () => {
    const r = computeAuctionResult(input({ myPKs: null, highestBid: 150n, highestBidderPK: PK_A, sealed: [PK_A], revealed: [PK_A] }));
    expect(r.me).toBe('unknown');
    expect(r.sold).toBe(true);
    expect(r.highestBid).toBe(150n);
  });

  it('myPKs = []: unknown as well', () => {
    expect(computeAuctionResult(input({ myPKs: [] })).me).toBe('unknown');
  });

  it('unknown is not confused with no-bid even when someone else won', () => {
    expect(computeAuctionResult(input({ myPKs: null, highestBid: 9n, highestBidderPK: PK_OTHER })).me).not.toBe('no-bid');
  });
});

const ui = (f: string): string => readFileSync(new URL(`../../frontend/src/${f}`, import.meta.url), 'utf8');

describe('result UI copy guard', () => {
  it('result copy never mentions refunds (the contract moves no funds)', () => {
    for (const f of [
      'components/AuctionResultPanel.tsx',
      'components/AuctionCard.tsx',
      'components/SettlementNote.tsx',
      'midnight/auctionResult.ts',
      'midnight/resultCopy.ts',
      'midnight/auctionActions.ts',
    ]) {
      expect(ui(f), f).not.toMatch(/refund|退款/i);
    }
  });

  it('bids and prices carry no currency unit (DUST is not transferable)', () => {
    expect(ui('components/AuctionResultPanel.tsx')).not.toMatch(/DUST/);
    expect(ui('midnight/resultCopy.ts')).not.toMatch(/DUST/);
    expect(ui('components/AuctionCard.tsx')).not.toMatch(/DUST/);
    // The network-fee line is a DUST fee, not a price — the one allowed mention.
    expect(ui('components/BidInput.tsx').replace('Network Fee: ~0.0002 DUST', '')).not.toMatch(/DUST/);
    expect(ui('pages/AuctionDetailPage.tsx').replace(/\/\/.*DUST.*\n/g, '')).not.toMatch(/DUST/);
    expect(ui('pages/HomePage.tsx')).not.toMatch(/Reserve Price \(DUST\)/);
  });

  it('HowItWorks mentions DUST only as the transaction-fee token, never as a bid currency or transferable', () => {
    const lines = ui('pages/HowItWorksPage.tsx').split('\n').filter((l) => /DUST/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/fees?\b/i);
    expect(ui('pages/HowItWorksPage.tsx')).not.toMatch(/DUST transfers|place bids/i);
  });

  it('architecture diagrams show the bid amount without a currency unit', () => {
    for (const f of ['../../docs/architecture.svg', '../../frontend/src/assets/architecture.svg']) {
      const text = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(text, f).toContain('amount = 200');
      expect(text, f).not.toMatch(/amount = 200 DUST/);
    }
  });

  it('bid input is integer-only, matching the handler (whole numbers 1..4294967295)', () => {
    const src = ui('components/BidInput.tsx');
    expect(src).toContain('step="1"');
    expect(src).toContain('min="1"');
    expect(src).toContain('inputMode="numeric"');
    expect(src).toContain('placeholder="0"');
    expect(src).not.toMatch(/placeholder="0\.00"|step="0\.01"/);
  });

  it('shows the fixed off-chain settlement note on the result panel and the detail page', () => {
    const NOTE =
      'Bids are recorded on-chain as plain numbers. Currency, payment and delivery are agreed and settled off-chain between the auctioneer and the winner.';
    expect(ui('components/SettlementNote.tsx')).toContain(NOTE);
    expect(ui('components/AuctionResultPanel.tsx')).toContain('<SettlementNote />');
    expect(ui('pages/AuctionDetailPage.tsx')).toContain('<SettlementNote />');
  });
});

// ---------------------------------------------------------------------------------------------
// "Auction Actions" panel visibility (frontend/src/midnight/auctionActions.ts)

const panel = (o: Partial<ActionsPanelInput>): boolean =>
  shouldShowActionsPanel({
    isClosed: true,
    itemClaimed: false,
    showClose: false,
    showReveal: false,
    showClaim: false,
    showFinalize: false,
    roleUnknown: false,
    ...o,
  });

describe('Auction Actions panel visibility', () => {
  it('hidden once the item is claimed — even while private state is locked (no Unlock prompt)', () => {
    expect(panel({ itemClaimed: true, roleUnknown: true })).toBe(false);
    expect(panel({ itemClaimed: true, roleUnknown: false })).toBe(false);
  });

  it('hidden for a finalized no-sale auction (finalizeAuction sets itemClaimed) — locked or unlocked', () => {
    // highestBid = 0 and itemClaimed = true: the auctioneer already finalized.
    expect(panel({ itemClaimed: true, showFinalize: false, roleUnknown: true })).toBe(false);
    expect(panel({ itemClaimed: true, showFinalize: false, roleUnknown: false })).toBe(false);
  });

  it('still shown while the winner has not claimed yet (claim button, or locked so role unknown)', () => {
    expect(panel({ showClaim: true })).toBe(true);
    expect(panel({ roleUnknown: true })).toBe(true); // closed, unclaimed, locked: Unlock to find out
  });

  it('still shown while the auctioneer has not finalized a no-sale auction', () => {
    expect(panel({ showFinalize: true })).toBe(true);
    expect(panel({ roleUnknown: true })).toBe(true);
  });

  it('still shown during the reveal window for a bidder who can reveal', () => {
    expect(panel({ showReveal: true })).toBe(true);
  });

  it('unchanged in the BIDDING phase: close button, or locked role, shows it; neither hides it', () => {
    expect(panel({ isClosed: false, showClose: true })).toBe(true);
    expect(panel({ isClosed: false, roleUnknown: true })).toBe(true);
    expect(panel({ isClosed: false })).toBe(false);
  });

  it('closed + unclaimed + role known + nothing to do (e.g. a non-winner after the deadline): hidden, as before', () => {
    expect(panel({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Reveal button vs. the contract's revealBid deadline check (blockTimeLt: now < revealDeadline)

const reveal = (o: Partial<Parameters<typeof canShowRevealButton>[0]>): boolean =>
  canShowRevealButton({ isClosed: true, hasSealedBid: true, hasRevealed: false, nowSec: BEFORE, revealDeadline: DEADLINE, ...o });

describe('Reveal button follows revealBid’s blockTimeLt(revealDeadline)', () => {
  it('shown before the deadline for a sealed, unrevealed bid', () => {
    expect(reveal({ nowSec: BEFORE })).toBe(true);
    expect(reveal({ nowSec: 0n })).toBe(true);
  });

  it('hidden once the deadline has passed', () => {
    expect(reveal({ nowSec: AFTER })).toBe(false);
    expect(reveal({ nowSec: DEADLINE + 86_400n })).toBe(false);
  });

  it('boundary: one second before the deadline is open, exactly at the deadline is closed (strict <)', () => {
    expect(reveal({ nowSec: DEADLINE - 1n })).toBe(true);
    expect(reveal({ nowSec: DEADLINE })).toBe(false);
    expect(reveal({ nowSec: DEADLINE + 1n })).toBe(false);
  });

  it('the reveal window and the final result are exact complements (no gap, no overlap) around the deadline', () => {
    for (const now of [DEADLINE - 2n, DEADLINE - 1n, DEADLINE, DEADLINE + 1n, DEADLINE + 2n]) {
      const finalized = computePublicResult({ isClosed: true, nowSec: now, revealDeadline: DEADLINE, highestBid: 1n }).finalized;
      expect(isRevealWindowOpen(now, DEADLINE), `now=${now}`).toBe(!finalized);
    }
  });

  it('still hidden when already revealed, when there is no sealed bid, or when the auction is not closed', () => {
    expect(reveal({ hasRevealed: true })).toBe(false);
    expect(reveal({ hasSealedBid: false })).toBe(false);
    expect(reveal({ isClosed: false })).toBe(false);
  });
});

describe('After the deadline: sealed but never revealed', () => {
  const abstained = computeAuctionResult(
    input({ nowSec: AFTER, highestBid: 200n, highestBidderPK: PK_OTHER, sealed: [PK_A, PK_OTHER], revealed: [PK_OTHER] }),
  );

  it('the result panel renders exactly the agreed "Not counted" copy', () => {
    expect(abstained.me).toBe('abstained');
    const { text, tone } = describeMyOutcome(abstained.me, { deadline: 'x', sold: abstained.sold, highestBid: abstained.highestBid });
    expect(text).toBe("Not counted. You placed a bid but didn't reveal it before the deadline, so it wasn't considered.");
    expect(text).toBe(NOT_COUNTED_TEXT);
    expect(tone).toBe('bad');
    // and the panel component really renders describeMyOutcome's text, not a copy of its own
    const panelSrc = ui('components/AuctionResultPanel.tsx');
    expect(panelSrc).toContain('describeMyOutcome(result.me');
    expect(panelSrc).toContain('{mine.text}');
  });

  it('the not-selected copy for a revealed loser quotes the winning bid without a currency', () => {
    const lost = describeMyOutcome('revealed-not-winner', { deadline: 'x', sold: true, highestBid: 200n });
    expect(lost.text).toBe('Not selected. Your bid was revealed but was not the highest. Winning bid: 200');
  });

  it('Auction Actions panel is hidden: unlocked (no flags) and locked (role unknown) alike, when someone won', () => {
    const revealShown = canShowRevealButton({ isClosed: true, hasSealedBid: true, hasRevealed: false, nowSec: AFTER, revealDeadline: DEADLINE });
    expect(revealShown).toBe(false);
    const abstainedAfterSale = abstained.me === 'abstained' && abstained.sold;
    expect(abstainedAfterSale).toBe(true);
    expect(panel({ showReveal: revealShown, roleUnknown: false, abstainedAfterSale })).toBe(false);
    expect(panel({ showReveal: revealShown, roleUnknown: true, abstainedAfterSale })).toBe(false);
  });

  it('no sale (nobody revealed) + locked: panel stays — this viewer might be the auctioneer who must finalize', () => {
    const noSale = computeAuctionResult(input({ nowSec: AFTER, highestBid: 0n, sealed: [PK_A], revealed: [] }));
    expect(noSale.me).toBe('abstained');
    expect(noSale.sold).toBe(false);
    expect(panel({ roleUnknown: true, abstainedAfterSale: noSale.me === 'abstained' && noSale.sold })).toBe(true);
    // ...and when unlocked as the auctioneer, the finalize button keeps it visible too
    expect(panel({ showFinalize: true, abstainedAfterSale: false })).toBe(true);
  });

  it('while the window is still open the same bidder keeps the reveal button and the panel', () => {
    const open = computeAuctionResult(input({ nowSec: BEFORE, sealed: [PK_A], revealed: [] }));
    expect(open.me).toBe('sealed-pending');
    expect(panel({ showReveal: true, abstainedAfterSale: open.me === 'abstained' && open.sold })).toBe(true);
  });
});
