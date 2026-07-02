# Midnight Private Auction — M2 前端錢包整合實作記錄

**日期範圍**：2026-07-01 ～ 2026-07-02
**專案**：`pplmaverick/midnight-private-auction`
**目標**：把 CLI 版（`src/api.ts`）的合約互動能力移植到瀏覽器前端（`frontend/`），走「路線 A：DApp Connector 委派」架構

---

## 1. 架構決策：路線 A vs 路線 B

**路線 B**（原本考慮）：把 CLI 那套「自己管理種子、本地推導金鑰、本地簽名送交易」的邏輯整個搬進瀏覽器。

**路線 A**（採用）：私鑰留在錢包擴充功能（Lace / 1AM）裡，前端透過 `@midnight-ntwrk/dapp-connector-api` 的 `ConnectedAPI` 委派簽名、餘額補平、送交易等操作。

**決策理由**：這是一個拍賣 dApp，使用者要用自己的錢包出價/領獎，私鑰不該進到網頁 JS 記憶體。路線 B 是把 CLI 的安全模型（開發者自己控管種子）硬套進面向一般使用者的產品，屬於安全反模式。

---

## 2. MidnightProviders 五塊拼圖總覽

`MidnightProviders` 介面（`midnight-js-types`）需要 5 個 provider。以下逐一記錄實作路徑、卡點、與最終解法。

| Provider | 檔案 | 狀態 |
|---|---|---|
| zkConfigProvider | `frontend/src/midnight/browserZkConfigProvider.ts` | ✅ 完成並用真實電路檔驗證 |
| publicDataProvider | `frontend/src/midnight/publicDataProvider.ts` | ✅ 完成並查過真實鏈上合約狀態 |
| proofProvider | `frontend/src/midnight/proofProvider.ts` | ✅ 完成並用 1AM 真實錢包驗證 |
| privateStateProvider | `frontend/src/midnight/browserPrivateStateProvider.ts` + `browserStorageEncryption.ts` | ✅ 完成，含 AES-256-GCM 加密 |
| walletProvider / midnightProvider | `frontend/src/midnight/walletProvider.ts` | ✅ 完成，`balanceTx`/`submitTx` 尚未做真實上鏈測試 |

---

## 3. zkConfigProvider（瀏覽器版）

**問題**：官方三個「瀏覽器專用」套件名稱（`browser-proof-provider`、`indexeddb-private-state-provider`、`browser-zk-config-provider`）經 npm 查詢全部 404，這些名稱在目前發布的 Midnight SDK 生態中不存在。

**解法**：`ZKConfigProvider<K>` 是 abstract class，只有 3 個真正要實作的抽象方法（`getZKIR`/`getProverKey`/`getVerifierKey`）。仿照 `NodeZkConfigProvider` 的路徑規則（`{dir}/zkir/{id}.bzkir`、`{dir}/keys/{id}.{prover,verifier}`），自己寫一版用 `fetch().then(r => r.arrayBuffer())` 取代 `fs.readFile`。

**電路檔案來源**：`contract/src/managed/auction/{zkir,keys}/`，複製到 `frontend/public/zkir/` 與 `frontend/public/keys/`。5 組電路：`createAuction`、`placeBid`、`closeAuction`、`revealBid`、`claimItem`。

**驗證**：5 個電路各自 fetch 成功，byte 數與原始檔案完全一致。

---

## 4. publicDataProvider

**發現**：`indexerPublicDataProvider` 本身就是 isomorphic（同構）套件，底層是 `@apollo/client` + `graphql-ws` + `isomorphic-ws` + `cross-fetch`，完全沒有 `fs`/`path`/`net`/`node:*` 的 import，可以原封不動照搬進前端。

**驗證**：對已部署合約 `872becfbc9d3142273c5dc5b7b1df5dae0fd0ee467c8857ea4e97f9a0408c21b` 呼叫 `queryContractState`，成功拿到真實鏈上 `ContractState`（`serialize()` 長度 11,945 bytes，非空狀態）。

**Cosmetic 警告**：Rollup build 會顯示 `Import "WebSocket" will always be undefined`，因為 `isomorphic-ws` 瀏覽器版沒有具名 `.WebSocket` 匯出，而 `indexerPublicDataProvider` 原始碼寫的是 `ws.WebSocket` 當預設參數。經追蹤 `graphql-ws` 的 `createClient` 原始碼，確認它在 `webSocketImpl` falsy 時會 fallback 讀取瀏覽器全域 `WebSocket`，功能不受影響，純粹是 build log 噪音。

---

## 5. proofProvider — 最大的一次架構轉折

### 5.1 原始計畫：委派給錢包（`getProvingProvider`）

型別比對：`dapp-connector-api` 的 `ProvingProvider`（`check`/`prove`，電路層級）與 `midnight-js-types` 的 `ProofProvider`（`proveTx`，交易層級）型別不同，但官方在 `midnight-js-types` 裡提供現成 adapter：

```ts
export declare const createProofProvider: (
  provingProvider: ProvingProvider,
  costModel?: CostModel
) => ProofProvider;
```

`ZKConfigProvider.asKeyMaterialProvider()` 的實作就是 `return this`，與 `getProvingProvider(keyMaterialProvider)` 要求的參數型別結構化相容，不需要額外轉型。

### 5.2 卡點：Lace 錢包不支援 `getProvingProvider`

**現象**：`connectorAPI.getProvingProvider(...)` 呼叫直接報錯（`TypeError`，不是 Promise reject）。追查後發現 `hintUsage` 也是同樣狀況——方法名稱在型別上「存在」，實際呼叫是 `undefined`。

**根因確認**：Midnight 官方論壇已有其他開發者回報同一現象（[Lace wallet doesn't implement getProvingProvider()](https://forum.midnight.network/t/lace-wallet-doesnt-implement-getprovingprovider-expected-behavior-or-version-gap/1213)）：用 1AM 錢包連線時 `getProvingProvider()` 正常運作、ZK proving 成功；用 Lace 連線時同一方法報錯。**這是已知的錢包 SDK 版本落差，非本專案架構問題。**

**曾考慮但否決的替代方案：自架公開 proof server**

官方文件明確指出，proof server 設計成跑在使用者本機是刻意的隱私考量：「這個連接是必要的，因為 proof server 需要私密資料作為輸入——使用遠端實例會損害使用者隱私」。本專案是私密拍賣（private auction），出價金額/鹽值屬於私密輸入。若架設一台公開 proof server 讓所有使用者瀏覽器連過去產生證明，等於使用者的私密出價資料要流經開發者控制的伺服器，與「private auction」的核心價值主張自相矛盾。**此方案被否決，不採用。**

**最終解法**：改用 1AM 錢包（已確認支援 `getProvingProvider()`，且支援 mainnet）。`WalletContext.tsx` 原本寫死 `connect('lace')`，改成可傳入 `walletHint` 參數；`walletConnector.ts` 底層本來就用 `Object.entries(window.midnight)` 列舉 + rdns/name 模糊比對識別錢包，架構本身沒問題，只是上層呼叫寫死了。

**額外選項（已記錄但未採用）**：`getConfiguration().proverServerUri`（標記 deprecated 但官方確認仍可用）。這是使用者自己在錢包設定裡指定的證明伺服器位址（概念上等同使用者自己電腦跑的 `127.0.0.1:6300`），與「dApp 自架公開伺服器」不是同一件事——只要 dApp 不主動引導使用者填入開發者控制的位址，這條路徑本身沒有隱私問題。留作 Lace 使用者的 fallback 提示文案方向，尚未實作。

### 5.3 驗證

用真實 1AM 錢包連線，`buildProofProvider(api, zk.asKeyMaterialProvider())` 成功回傳物件，`proveTx` 方法存在。

---

## 6. privateStateProvider（IndexedDB 版）

### 6.1 介面規格

`PrivateStateProvider<PSI, PS>`，13 個必須實作的方法：`set`/`get`/`remove`/`clear`/`setSigningKey`/`getSigningKey`/`removeSigningKey`/`clearSigningKeys`/`exportPrivateStates`/`importPrivateStates`/`exportSigningKeys`/`importSigningKeys`/`setContractAddress`。

隱藏約束（來自型別定義註解）：
- `get`/`getSigningKey`：key 不存在回傳 `null`，但**解密失敗必須 throw，不能吞成 null**
- `get` 之前必須先呼叫過 `setContractAddress`，否則要 throw
- 允許「讀取時順便遷移舊資料格式並寫回」的實作彈性

### 6.2 加密金鑰來源：三個方案的淘汰過程

**方案 1（簽名衍生金鑰）—— 已否決，實測證偽**

構想：請錢包對固定訊息 `signData`，用簽名結果衍生對稱金鑰。

**實測結果**：用 1AM 對同一段固定訊息連續簽名兩次，兩次結果完全不同（`verifyingKey` 相同，代表帳戶身份沒變，但簽名本身每次不同）。這是 ECDSA/EdDSA 這類簽名演算法的標準特性——為了安全性，簽名過程會混入隨機值，同一訊息、同一私鑰，每次簽出來的結果本來就不同。**這不是 Midnight 特有問題，是所有主流簽名演算法的通用特性**，任何鏈上直接拿簽名結果當金鑰都不成立。方案 1 整個不可行：每次連線衍生出不同金鑰，會把上一次存的資料鎖死解不開。

**方案 3（瀏覽器裝置金鑰 / Web Crypto non-extractable CryptoKey）—— 提出但未採用**

不可匯出金鑰換瀏覽器/清瀏覽器資料就報銷，對「押金卡在合約裡拿不回來」這種後果風險太高，優先淘汰。

**方案 3'（Midnight 原生 shieldedEncryptionPublicKey）—— 已否決，實測證偽**

構想：`getEncryptionPublicKey()`/`getShieldedAddresses()` 回傳的 `shieldedEncryptionPublicKey`，是否能用來做應用層加解密。

**查證結果**：`ledger-v8.d.ts` 官方註解明確寫著，`EncryptionSecretKey` 的用途是「持有使用者的加密密鑰，用來判斷某筆 offer 是否包含寄給該使用者的輸出」——這是 Midnight shielded 交易協定裡的機制（概念上類似 Zcash 的 incoming viewing key），只有一個 `test(offer): boolean` 方法，**沒有任何 `decrypt(密文)` 這種通用解密方法**。逐行搜尋 `dapp-connector-api` 的 `WalletConnectedAPI` 型別定義，13 個核心方法裡沒有一個含 `decrypt` 語意。**結論：此金鑰只給「別人要匯 shielded 資產給你」用，DApp 端完全沒有管道請錢包解密任意資料。**（附帶參考：MetaMask 以前有過 `eth_getEncryptionPublicKey`/`eth_decrypt`，後來因安全疑慮棄用，Midnight 錢包不暴露此能力可能是有意識的設計選擇，不是缺陷。）

**方案 2（使用者自訂密碼 + PBKDF2）—— 最終採用**

日常讀寫（`set`/`get`/`remove` 等）與匯出/匯入備份統一使用同一套密碼機制，理由：
- 前兩個方案排除後，這是唯一站得住腳、可預期、不綁裝置也不綁特定錢包廠牌的選項
- 兩套獨立密碼系統只會讓使用者更困惑，統一成本更低

**UX 設計**：密碼只在該 session 第一次需要用到 private state 時輸入一次，PBKDF2 衍生出的 AES 金鑰存在記憶體閉包變數（`unlock`/`lock`/`isUnlocked` 三個額外方法，仿照 Node CLI 版 `levelPrivateStateProvider` 附加 `changePassword` 的模式），`lock()` 或分頁關閉/reload 即清除，絕不落地。

### 6.3 實作細節

- `browserStorageEncryption.ts`：PBKDF2（600,000 次迭代，與 Node CLI 版一致）+ AES-256-GCM，全用 `window.crypto.subtle`，無額外套件依賴
- Salt：每個帳戶（accountId）、每個 store（`private-state`/`signing-key`）各一把，存在 IndexedDB（salt 本身非秘密，與加密資料放一起無妨），與 Node CLI 版做法一致
- 手刻 BigInt/Uint8Array 安全的 JSON 序列化（`AuctionPrivateState` 含 bigint 與 Uint8Array 欄位，原生 `JSON.stringify` 直接報錯，未引入 `superjson` 等額外依賴）
- `exportPrivateStates`/`importPrivateStates`/`exportSigningKeys`/`importSigningKeys` 要求呼叫者傳入獨立的 `options.password`，不依賴 session 解鎖狀態

### 6.4 驗證（5/5 通過）

| # | 驗證項目 | 結果 |
|---|---|---|
| 1 | 未 `unlock()` 呼叫 `get` | 正確丟出 `PrivateStateLockedError` |
| 2 | 正確密碼 unlock → set → get（含 BigInt、Uint8Array） | 型別完全正確讀回 |
| 3 | `lock()` 後再呼叫 `get` | 正確丟出 `PrivateStateLockedError` |
| 4 | 錯誤密碼 unlock 後讀取 | 正確丟出 `OperationError`（AES-GCM 認證標籤驗證失敗，非亂碼/null） |
| 5 | 換回正確密碼後再讀 | 資料完好 |

---

## 7. walletProvider / midnightProvider

**沒有官方 adapter**，需自行組裝，npm 查詢 `midnight-js-dapp-connector-provider` 等命名皆 404。

### 7.1 三個具體落差與驗證結果

**A. Transaction 序列化/反序列化**

`Transaction` class 有對稱的 `serialize()`/`static deserialize(markerS, markerP, markerB, raw)`，marker 規則與 `Intent.deserialize`（`src/api.ts:202` 既有用法）同一套：
- Signature: `'signature' | 'signature-erased'`
- Proof: `'proof' | 'pre-proof' | 'no-proof'`
- Binding: `'binding' | 'pre-binding' | 'no-binding'`

`UnprovenTransaction = Transaction<SignatureEnabled, PreProof, PreBinding>`。

實測 `Transaction.fromParts('mainnet')` 建立最小 tx，`serialize() → deserialize() → serialize()` 往返 bytes 完全一致（90 bytes）。**不需要 Buffer polyfill**，全程只用 `Uint8Array`。

**B. `getCoinPublicKey()`/`getEncryptionPublicKey()` 同步 vs 錢包非同步 API**

官方介面要求同步回傳，但 `getShieldedAddresses()` 是非同步。解法：`connect()` 完成後立即呼叫一次並快取結果，`getCoinPublicKey()`/`getEncryptionPublicKey()` 讀快取；未初始化時呼叫要 throw 明確錯誤，不能回傳 `undefined`。

**編碼格式落差**：`getShieldedAddresses()` 回傳 Bech32m 格式字串（如 `mn_shield-cpk1...`），而底層型別要 hex。轉換套件是 `@midnight-ntwrk/wallet-sdk-address-format`（不在 `ledger-v8`）：`MidnightBech32m.parse()` 解出 `{type, network, data}`，`ShieldedCoinPublicKey.fromHexString()`/`.toHexString()` 互轉。

**⚠️ 文件與實測不符**：`ledger-v8.d.ts` 官方註解寫「hex-encoded 35-byte string」，實測轉出來是 **32 bytes（64 hex 字元）**。`ShieldedCoinPublicKey` class 本身定義 `static readonly keyLength = 32`。用現有 Node CLI 版 `src/api.ts:228-229`（`state.shielded.coinPublicKey.toHexString()`，已在 mainnet 正常運作）交叉驗證，確認 32-byte hex 才是實際吃得下的格式，**文件註解沒跟上實作**。往返驗證（hex → 物件 → hex）一致。

**需要 Buffer polyfill**：`wallet-sdk-address-format` 內部直接用 Node 全域 `Buffer`，瀏覽器沒有，需補裝 `buffer` 套件並掛到 `window.Buffer`。（注意：這與上面 A 段的 Transaction 序列化不同，該段不需要 Buffer polyfill，兩層各自獨立判斷。）

**C. `submitTx` 的 TransactionId**

官方介面：`submitTx(tx: FinalizedTransaction): Promise<TransactionId>`；connector 的 `submitTransaction(tx: string): Promise<void>` 完全沒有回傳 TransactionId，需自行從 Transaction 本地算出。

`Transaction` class 上有 `identifiers(): TransactionId[]` 與 `transactionHash(): TransactionHash`。**用 `identifiers()`，不用 `transactionHash()`**——官方註解明確說明：`transactionHash()` 「由於交易可能被合併，不應該用這個來追蹤特定交易」；`identifiers()` 「回傳的每一個 identifier 都可以用來追蹤這筆特定交易」。

實測確認：`identifiers()` 在 unproven tx（無 intent）上回傳空陣列 `[]`（非 bug，因測試 tx 沒放任何合約呼叫）；`mockProve()` + `bind()` 後 `transactionHash()` 正常回傳 hex 字串。本拍賣合約操作模式（createAuction/placeBid/closeAuction 等）每次都是單一呼叫、不會合併多個 intent，故 `identifiers()[0]` 即為正確答案。

### 7.2 尚未完成

- `balanceTx()` 真實呼叫測試（需要 DUST 餘額，錢包已在生成中，尚未實測完整流程）
- `submitTx()` 真實上鏈測試（刻意延後，避免調試過程意外送出交易）

---

## 8. 建置環境踩坑：Vite 對 wasm ESM import 的支援缺口

**現象**：連線 Lace 觸發 `getProvingProvider` 之前，任何 console.log 都還沒印出就先報錯：

```
midnight_ledger_wasm.js:5:6
Cannot access '__wbindgen_start' before initialization
```

**根因**：`@midnight-ntwrk/ledger-v8`（`midnight-js-types`/`dapp-connector-api` 的底層依賴，wasm-bindgen 產出）使用「WebAssembly ESM Integration」提案語法直接 `import * as wasm from "./xxx_bg.wasm"`。這不是瀏覽器或 Vite/esbuild 預設支援的語法，若無對應 plugin 轉譯，wasm 模組初始化順序會亂掉。

**解法**：安裝 `vite-plugin-wasm`（3.6.0）+ `vite-plugin-top-level-await`（1.6.0），這是 Midnight 官方範例 dApp 常見的標準搭配，只影響建置流程對 `.wasm` import 的處理，不動業務邏輯程式碼。

### 8.2 vite-plugin-wasm 套件本身的型別宣告 bug

**時間點**：Vercel 生產環境部署失敗後才發現，本機當初只跑過 `npx tsc --noEmit`（片段檢查），沒跑過完整的 `npm run build`（實際指令是 `tsc -b && vite build`），`vite.config.ts` 本身沒被完整型別檢查過，導致本機「看似正常」但部署直接炸掉。**教訓：之後任何改動，驗證指令一律用 `npm run build`，不能只信賴 `tsc --noEmit`。**

**錯誤訊息**：
vite.config.ts(15,37): error TS2349: This expression is not callable.
Type 'typeof import(".../vite-plugin-wasm/dist/index")' has no call signatures.

**根因**：`vite-plugin-wasm` 套件本身的型別宣告與實際 runtime 檔案不一致——`package.json` 的 `exports."import".types` 指向 `dist/index.d.ts`（型別寫成 `export default function wasm(): any`），但實際 runtime 載入的是 `exports/import.mjs`，這個檔案攤平 default export 的方式跟型別宣告對不上。在 TypeScript `nodenext` 模組解析下，`import wasm from 'vite-plugin-wasm'` 被誤判成整個模組物件（`typeof import(...)`），不是函式本身，因此報 `not callable`。

**驗證過但不採用的修法**：
- 加 `esModuleInterop: true` → 型別錯誤依舊存在
- 改成 `wasm.default()` → 型別檢查會過，但**用 Node 直接 `require` 實測確認**，實際載入後 `wasm` 本身就是函式，根本沒有 `.default` 屬性——這個寫法會讓 build 通過、但 app 在 runtime 直接壞掉，比原本的 build 失敗更難查，故不採用。

**最終解法**：在 import 之後用 `as unknown as () => Plugin` 做窄範圍的型別修正，對應到已用 Node 實測確認過的真實 runtime 型別，並在程式碼裡加註解說明原因（這不是用 `any` 繞過型別檢查偷懶，是修正上游套件本身標錯的型別宣告）。

**後續追蹤**：這是上游套件 `vite-plugin-wasm` 本身的 bug，不是本專案架構問題。之後若升級此套件版本，應先檢查這個型別宣告不一致的問題是否已被上游修掉，若已修掉可以移除這段 workaround。
---

## 9. 給下次接手（Claude Code）的重點提醒

1. **Lace 不支援 `getProvingProvider`/`hintUsage` 是已知版本落差**，不要浪費時間重新調查同一個問題；優先用 1AM 測試委派證明路徑。若未來 Lace 版本更新，可重新測試是否已補上。
2. **絕對不要架設公開 proof server 讓使用者瀏覽器連線**——這違反私密拍賣的核心價值主張，使用者私密輸入不該經過開發者伺服器。如果需要處理 Lace 使用者的證明路徑，方向是「引導使用者自己在本機跑 proof server」，不是「開發者代為架設」。
3. **不要用簽名結果衍生加密金鑰**——ECDSA/EdDSA 類簽名演算法設計上非確定性，任何鏈都一樣，這不是 Midnight 特有限制。
4. **`ledger-v8.d.ts` 的文件註解可能落後於實作**（35-byte vs 實測 32-byte 就是一例），遇到型別/文件與現有 mainnet 上已跑通的 Node CLI 版程式碼（`src/api.ts`）不一致時，以現有可運作的程式碼行為為準，並交叉驗證。
5. **`identifiers()` 而非 `transactionHash()`** 來取得可用於追蹤特定交易的 ID。
6. Buffer polyfill 只有 `wallet-sdk-address-format` 這層需要，`Transaction` 序列化不需要，避免重複判斷或誤加。
7. Vite 專案的 wasm plugin（`vite-plugin-wasm` + `vite-plugin-top-level-await`）是所有依賴 `ledger-v8` 的功能的前提，未來若專案改用其他建置工具（如提到的 rolldown-vite）需重新確認相容性，這塊尚未完整驗證，遇到 wasm 初始化錯誤先檢查 plugin 設定是否還在。

---

## 10. 可提交給官方 repo 的 GitHub Issue 草稿（Lace wallet）

**倉庫**：`midnightntwrk/midnight-dapp-connector-api`（或 Lace 錢包自己的 repo，視實際歸屬調整）

**標題**：`Lace wallet reports getProvingProvider/hintUsage as present but throws on call (apiVersion 4.0.1)`

**環境資訊**：
- `@midnight-ntwrk/dapp-connector-api`: 4.0.1
- Lace wallet apiVersion: 4.0.1（宣告值）
- Network: mainnet
- Browser: （待補：實際測試用的 Chrome 版本）

**重現步驟**：
1. 用 `connect('mainnet')` 連線 Lace 錢包，取得 `ConnectedAPI`
2. 確認 `typeof connectorAPI.getProvingProvider === 'function'` → `true`
3. 呼叫 `connectorAPI.getProvingProvider(keyMaterialProvider)`

**預期行為**：依照 `dapp-connector-api` v4.0.1 型別定義，`getProvingProvider` 是 `WalletConnectedAPI` 上的必要（非 optional）方法，呼叫後應回傳 `Promise<ProvingProvider>`。

**實際行為**：呼叫直接拋出 `TypeError`（非 Promise reject），代表底層實際值是 `undefined`，儘管 `typeof` 檢查顯示該屬性存在。`hintUsage` 方法同樣現象。

**額外資訊**：同樣的呼叫序列，改用 1AM 錢包（同版本 `dapp-connector-api@4.0.1`）可正常運作，`getProvingProvider` 成功回傳含 `check`/`prove` 方法的物件。社群論壇已有其他開發者回報同一問題：[Lace wallet doesn't implement getProvingProvider() - Midnight Forum](https://forum.midnight.network/t/lace-wallet-doesnt-implement-getprovingprovider-expected-behavior-or-version-gap/1213)

**影響**：任何依賴 `getProvingProvider` 委派 ZK 證明產生的 dApp（官方推薦的證明架構，取代舊有的本機 proof server URL 模式）在 Lace 使用者身上完全無法運作，被迫要求使用者改用其他錢包或自行架設本機 proof server。

*（提交前請補上實測的瀏覽器版本、完整錯誤 stack trace，並確認是否要附上最小重現 repo。）*

---

## 11. 尚未完成事項（下次繼續）

- [ ] UI 密碼輸入框串接（private state 解鎖用）
- [ ] 組出完整 `AuctionProviders` 整合物件，接上實際的下注/建立拍賣按鈕
- [ ] `balanceTx()` 真實呼叫測試（等 DUST 到帳）
- [ ] `submitTx()` 真實上鏈測試（含完整 e2e：createAuction → placeBid → closeAuction → revealBid → claimItem）
- [ ] Lace 使用者的 fallback UX 文案（`getProvingProvider` 不存在時的提示）
- [ ] 視情況將第 10 節的 Issue 草稿補完並提交至官方 repo
