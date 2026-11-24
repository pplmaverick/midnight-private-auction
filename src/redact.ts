/**
 * Shared output redaction for the CLI scripts (check-wallet, deploy-dry-run, deploy-only).
 *
 * redact() strips: the wallet seed (either case); the query string of ANY http(s)/ws(s) URL;
 * `project_id=…`; Blockfrost-shaped tokens (`night<network>…`); and ANY bare 64-hex string
 * (seeds / keys). Because a contract address and a tx hash are ALSO 64 hex characters, results that
 * must stay readable are printed with printResult(), which bypasses the 64-hex mask but only accepts
 * a strictly whitelisted shape (64 hex, or a plain non-negative integer) and refuses anything equal
 * to the seed. Everything else — including SDK console output — goes through redact().
 */
import { inspect } from 'node:util';
import { Cause } from 'effect';

// Captured at module load, i.e. BEFORE installConsoleRedaction() replaces console.*.
const rawLog = console.log.bind(console);
const rawError = console.error.bind(console);
const rawWarn = console.warn.bind(console);
export const rawConsoleLog: (...a: unknown[]) => void = rawLog;
export const rawConsoleError: (...a: unknown[]) => void = rawError;
export const rawConsoleWarn: (...a: unknown[]) => void = rawWarn;

const extraSecrets = new Set<string>();
/** Register an additional literal to mask (e.g. a private RPC URL). The seed is read from env. */
export const registerSecret = (value: string | undefined): void => {
  if (value && value.length >= 8) extraSecrets.add(value);
};

const maskLiteral = (text: string, secret: string): string =>
  text.split(secret).join('***').split(secret.toLowerCase()).join('***').split(secret.toUpperCase()).join('***');

export const redact = (text: string): string => {
  let out = text;
  const seed = process.env.WALLET_SEED;
  if (seed) out = maskLiteral(out, seed);
  for (const s of extraSecrets) out = maskLiteral(out, s);
  out = out.replace(/\b(https?|wss?):\/\/[^\s"'<>)]*/gi, (url) => url.split('?')[0] + (url.includes('?') ? '?***' : ''));
  out = out.replace(/project_id=[^&\s"')]+/gi, 'project_id=***');
  out = out.replace(/\bnight(mainnet|preprod|preview)[A-Za-z0-9]+/g, 'night$1***');
  out = out.replace(/\b[0-9a-fA-F]{64}\b/g, '<64hex>');
  return out;
};

// Full expansion of an error / Effect Cause / arbitrary object.
export const describe = (value: unknown): string => {
  try {
    if (Cause.isCause(value)) return Cause.pretty(value);
    if (value instanceof Error || (typeof value === 'object' && value !== null)) {
      return inspect(value, { depth: 6, breakLength: 160, maxStringLength: 600, getters: true, showHidden: false });
    }
  } catch {
    /* fall through */
  }
  return String(value);
};
export const clip = (text: string, max = 1500): string => (text.length > max ? `${text.slice(0, max)}…[truncated]` : text);
export const safe = (value: unknown): string => clip(redact(describe(value)));

export type ResultKind = 'hex64' | 'int';

/** Whitelisted, unmasked result line: `label: value`. Refuses any value that is not the expected shape or equals the seed. */
export const printResult = (label: string, value: unknown, kind: ResultKind, prefix = ''): void => {
  const text = typeof value === 'bigint' || typeof value === 'number' ? String(value) : String(value ?? '');
  const shapeOk = kind === 'hex64' ? /^[0-9a-fA-F]{64}$/.test(text) : /^[0-9]{1,15}$/.test(text);
  const seed = process.env.WALLET_SEED?.toLowerCase();
  if (!shapeOk || (seed && text.toLowerCase() === seed)) {
    rawLog(`${prefix}${label}: <withheld: unexpected shape>`);
    return;
  }
  rawLog(`${prefix}${label}: ${text}`);
};

type ConsoleFn = (...a: unknown[]) => void;
export interface ConsoleRedactionOptions {
  /** Return true to swallow the (already stringified, NOT yet redacted) line instead of printing it. */
  readonly filter?: (text: string, redactedText: string, orig: ConsoleFn) => boolean;
}
export interface RawConsole {
  readonly log: ConsoleFn;
  readonly error: ConsoleFn;
  readonly warn: ConsoleFn;
}

/** Replace console.log/error/warn so everything printed (including SDK/Effect logging) is redacted. */
export const installConsoleRedaction = (options: ConsoleRedactionOptions = {}): RawConsole => {
  const wrap =
    (orig: ConsoleFn): ConsoleFn =>
    (...args: unknown[]): void => {
      const text = args.map((a) => (typeof a === 'string' ? a : describe(a))).join(' ');
      const red = redact(text);
      if (options.filter?.(text, red, orig)) return;
      orig(red);
    };
  console.log = wrap(rawLog);
  console.error = wrap(rawError);
  console.warn = wrap(rawWarn);
  return { log: rawLog, error: rawError, warn: rawWarn };
};
