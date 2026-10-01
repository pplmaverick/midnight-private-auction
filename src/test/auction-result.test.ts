import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeAuctionResult, computePublicResult, type AuctionResultInput } from '../../frontend/src/midnight/auctionResult.js';

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
    ]) {
      expect(ui(f), f).not.toMatch(/refund|退款/i);
    }
  });

  it('bids and prices carry no currency unit (DUST is not transferable)', () => {
    expect(ui('components/AuctionResultPanel.tsx')).not.toMatch(/DUST/);
    expect(ui('components/AuctionCard.tsx')).not.toMatch(/DUST/);
    // The network-fee line is a DUST fee, not a price — the one allowed mention.
    expect(ui('components/BidInput.tsx').replace('Network Fee: ~0.0002 DUST', '')).not.toMatch(/DUST/);
    expect(ui('pages/AuctionDetailPage.tsx').replace(/\/\/.*DUST.*\n/g, '')).not.toMatch(/DUST/);
    expect(ui('pages/HomePage.tsx')).not.toMatch(/Reserve Price \(DUST\)/);
  });

  it('shows the fixed off-chain settlement note on the result panel and the detail page', () => {
    const NOTE =
      'Bids are recorded on-chain as plain numbers. Currency, payment and delivery are agreed and settled off-chain between the auctioneer and the winner.';
    expect(ui('components/SettlementNote.tsx')).toContain(NOTE);
    expect(ui('components/AuctionResultPanel.tsx')).toContain('<SettlementNote />');
    expect(ui('pages/AuctionDetailPage.tsx')).toContain('<SettlementNote />');
  });
});
