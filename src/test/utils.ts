import { randomBytes as cryptoRandomBytes } from 'crypto';

export const randomBytes = (length: number): Uint8Array =>
  new Uint8Array(cryptoRandomBytes(length));
