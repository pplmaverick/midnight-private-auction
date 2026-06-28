# Midnight Mainnet Deploy — Debug Notes

## 1. 官方 testkit 的 node / nodeWS 配置方式

官方 `EnvironmentConfiguration` 介面（`@midnight-ntwrk/testkit-js`）把節點拆成兩個欄位：

```typescript
interface EnvironmentConfiguration {
  node:   string;   // HTTP URL — 只用於 NodeClient.health() 和 dapp connector getConfiguration()
  nodeWS: string;   // WS URL  — 用於 relayURL（Substrate tx submission）
}
```

官方 `mapEnvironmentToConfiguration` 實作：

```javascript
// node_modules/@midnight-ntwrk/testkit-js/dist/index.mjs, line 1528
{
  indexerClientConnection: {
    indexerHttpUrl: env.indexer,
    indexerWsUrl:   env.indexerWS,
  },
  provingServerUrl: new URL(env.proofServer),
  networkId:        env.walletNetworkId,
  relayURL:         new URL(env.nodeWS),   // ← WS 端點才是 relay
  costParameters: {
    feeBlocksMargin: 5,                    // 官方預設值，我們與此一致
    // 官方沒有 additionalFeeOverhead
  },
}
```

preprod 的官方範例值：
```
node:   'https://rpc.preprod.midnight.network'
nodeWS: 'wss://rpc.preprod.midnight.network'   // ← 只把 https 換成 wss，路徑相同
```

---

## 2. 我們 buildDustConfig 目前的轉換邏輯

`src/api.ts` 中的 `buildDustConfig`：

```typescript
const buildDustConfig = ({ indexer, indexerWS, node, proofServer }: Config) => ({
  networkId:    getNetworkId(),
  costParameters: {
    additionalFeeOverhead: 300_000_000_000_000n,  // ← 官方沒有此項，可能是問題
    feeBlocksMargin: 5,
  },
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, 'ws')),  // ← 自動把 https→wss
});
```

這個自動轉換對公開節點是**正確的**，因為官方 preprod 也是 `https:` → `wss:`（路徑不變）。

---

## 3. 私有 RPC 無法用於 relay 的根本原因

Ricardo 提供的私有 RPC：
- HTTP: `https://rpc.mainnet.midnight.foundation/v1/mk_831206ddad3db4237a1b4e393f200360`
- WS:   `wss://rpc.mainnet.midnight.foundation/v1/mk_831206ddad3db4237a1b4e393f200360`

**測試結果**：WS 連上後立即斷線（1006 Abnormal Closure）。  
**原因**：該端點只提供 HTTP REST API，不支援 Substrate WebSocket 協議（polkadot.js `WsProvider` 需要的協議）。  
**結論**：私有 RPC **無法**用於 `relayURL`（tx submission），只能走公開節點。

---

## 4. 1016: Immediately Dropped 錯誤分析

| 項目 | 狀態 |
|------|------|
| 公開節點 WS (`wss://rpc.mainnet.midnight.network`) | ✅ 正常（已驗證 system_health 回應） |
| Substrate tx pool pending txs | ✅ 0（空池） |
| 節點健康 | ✅ 8~10 peers，isSyncing: false |
| DUST 餘額 | ✅ ~638 DUST |

可能原因（未確認）：
- `additionalFeeOverhead: 300_000_000_000_000n` 造成 tx 結構異常（官方不設此項）
- 先前私有 RPC 的 888 次重試在公開 mempool 留下過期 tx，當時池子滿了

待嘗試的修正：
1. 移除 `additionalFeeOverhead`，改用官方預設（不設此項）
2. 確認 `additionalFeeOverhead` 的單位是否合理（1 DUST ≈ 10^15 smallest units，300 兆 = 0.3 DUST，應該合理）
3. 再次部署（池子現在是空的，應可成功）

---

## 5. 部署指令

```bash
WALLET_SEED=3783c9ca703ab88d6d3cd408bae9097a91269b42f518528b2a4ec18254bcf7d2 \
MIDNIGHT_INDEXER=https://indexer.mainnet.midnight.network/api/v3/graphql \
MIDNIGHT_INDEXER_WS=wss://indexer.mainnet.midnight.network/api/v3/graphql/ws \
MIDNIGHT_NODE=https://rpc.mainnet.midnight.network \
npm run deploy:mainnet
```

私有 RPC 只能作為 reference，**不能**在 `MIDNIGHT_NODE` 設私有 endpoint（WS 不通）。

---

## 6. 錢包地址（mainnet）

```
Unshielded : mn_addr1zamsn087m6gkgsqu4wkceeu3vpmpj0ksrmslnhy0y55st3yef7fsetsfzk
DUST       : mn_dust1ww8mucvaf2fj3xuaygk37zhhkh5pdkcxelujt2uamjs4mykhuds37ekfs22
```

## 7. wallet-state 檔案

```
.wallet-state/dust-checkpoint.json     ← DustWallet 同步點（offset=136419）
.wallet-state/shielded-checkpoint.json ← ShieldedWallet 同步點
```

**勿刪除這兩個檔案**，刪了要重新同步 20-40 分鐘。
