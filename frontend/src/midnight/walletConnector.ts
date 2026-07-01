import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api'

// `window.midnight` is already declared globally by @midnight-ntwrk/dapp-connector-api
// (see node_modules/@midnight-ntwrk/dapp-connector-api/dist/globals.d.ts), so it is not
// redeclared here. Its real shape is `{ [key: string]: InitialAPI } | undefined`.
//
// Per CAIP-372, wallets register themselves under a random UUID key (not a fixed
// name like "mnLace") — the key itself is not human-readable or stable across
// browser sessions, so wallets must be identified by their `rdns`/`name` fields instead.

export type WalletState =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | { status: 'connected'; api: ConnectedAPI; address: string; balance: string; provingSupported: boolean }
  | { status: 'error'; message: string }

export interface WalletInfo {
  key: string
  rdns: string
  name: string
  icon: string
}

// 偵測可用的 wallet providers
export function detectWallets(): WalletInfo[] {
  if (typeof window === 'undefined' || !window.midnight) return []
  return Object.entries(window.midnight)
    .filter((entry): entry is [string, InitialAPI] => entry[1] !== undefined)
    .map(([key, api]) => ({ key, rdns: api.rdns, name: api.name, icon: api.icon }))
}

// 連線到符合 hint 的 provider（依 rdns/name 模糊比對；只有一個錢包時直接使用，不管 hint 對不對）
export async function connectWallet(
  hint: string = 'lace',
): Promise<{ api: ConnectedAPI; address: string; balance: string }> {
  const wallets = detectWallets()

  let target = wallets.find(
    (w) =>
      w.key === hint ||
      w.rdns.toLowerCase().includes(hint.toLowerCase()) ||
      w.name.toLowerCase().includes(hint.toLowerCase()),
  )
  if (!target && wallets.length === 1) {
    target = wallets[0]
  }

  if (!target) {
    console.log('[walletConnector] window.midnight wallets detected:', wallets)
    throw new Error(
      wallets.length > 0
        ? `Could not resolve a wallet matching "${hint}". Detected: ${wallets.map((w) => `${w.name} (${w.rdns})`).join(', ')}`
        : 'No wallet detected on window.midnight — is Lace installed and enabled for this site?',
    )
  }

  const provider = window.midnight![target.key]!

  // Connect to mainnet. The installed API has a single connect(networkId) call —
  // there is no separate isEnabled()/enable() step.
  const api = await provider.connect('mainnet')

  // 取得地址（unshielded address，用於畫面顯示）
  let address = 'unknown'
  try {
    const { unshieldedAddress } = await api.getUnshieldedAddress()
    address = unshieldedAddress
  } catch {
    address = 'unknown'
  }

  // 取得 DUST 餘額（用字串顯示）
  let balance = '-- DUST'
  try {
    const dust = await api.getDustBalance()
    balance = `${dust.balance.toString()} DUST`
  } catch {
    balance = '-- DUST'
  }

  return { api, address, balance }
}

// 截斷地址顯示
export function truncateAddress(address: string, chars = 6): string {
  if (address.length <= chars * 2 + 3) return address
  return `${address.slice(0, chars)}...${address.slice(-chars)}`
}
