# Bug Hunt — Midnight Private Auction

Findings from a walkthrough of the contract, TypeScript SDK layer, and frontend, cross-referenced against GitHub Issues in the official Midnight repos.

## Phase 1 — Findings

| # | 行為描述 | 發現位置 | 嚴重度 | 上游問題？ |
|---|---|---|---|---|
| 1 | Contract 編譯產物在 `frontend/` 外部，monorepo 解析落到兩份 node_modules，各自實例化一份 WASM，導致 `instanceof` 檢查失敗（wasm-bindgen dual instantiation）。用 `resolve.dedupe` 修掉 | `frontend/vite.config.ts:6-30` | 高 | 是 |
| 2 | `vite-plugin-wasm` 的型別宣告與實際 runtime export 不符，需要 cast | `frontend/vite.config.ts:6-11` | 低 | 是（第三方套件，非 Midnight repo） |
| 3 | Vite workspace-root 自動偵測擋掉 `../contract/*` 請求，用 `server.fs.allow` 修掉 | `frontend/vite.config.ts:39-47` | 低 | 否 |
| 4 | ShieldedWallet 的 WASM commitment tree 只能長不能縮，genesis sync 若正常啟動會進入 retry-loop 洩漏記憶體（實測撞到 11GB 當機）。用 Phase-1 stub 繞過 | `src/api.ts:37-125, 278-353`；README 278-283 | 高 | 是 |
| 5 | Deploy 交易內嵌全部電路的 verifier key，體積超過公開 RPC 限制，被 `1016: Immediately Dropped` 拒絕 | README 284-291；`src/index.ts:85-108` | 高 | 是 |
| 6 | 部分 SDK 版本的 `balanceUnboundTransaction` 不會自動簽署 unshielded signer 的 transaction intents，需手動處理 | `src/api.ts:192-221`；README 292-294 | 中高 | 是 |
| 7 | Compact 語言沒有可安全使用的 on-chain time API：`endTime`/`revealDeadline` 只在 `createAuction` 寫入，之後任何電路都沒有 assert 過，phase 轉換完全靠人工呼叫 | `contract/src/auction.compact:60-61, 118-133`（宣告/寫入）vs. 156-214（從未讀取） | 高 | 是 |
| 8 | Lace 錢包型別上宣告支援 `getProvingProvider`，但實際呼叫會丟 `TypeError` | `frontend/src/midnight/proofProvider.ts:4-14` | 高 | 是 |
| 9 | 前端 UI 只用 `BIDDER1_STATE_ID`，`BIDDER2_STATE_ID` 型別存在但整個前端從未使用，註解與行為不一致 | `frontend/src/pages/AuctionDetailPage.tsx:244,319,329,358,367`；`frontend/src/midnight/contract.ts:23-24,50-51` | 中 | 否 |
| 10 | `dapp-connector-api` 的 `balanceUnsealedTransaction` 沒有 `ttl` 參數，呼叫端傳入值被靜默丟棄 | `frontend/src/midnight/walletProvider.ts:68-72` | 低 | 是 |
| 11 | 多處 `as any` 集中在解析 wallet checkpoint JSON、`queryContractState` 回傳型別上 | `src/api.ts:67,90,105,135,243,506`；`src/index.ts:185-186`；`src/e2e-existing.ts:123` | 低 | 否 |
| 12 | `AuctionDetailPage` 首次載入沒有 loading state，`refreshAuctionStatus` 的 catch 靜默吞掉所有錯誤 | `frontend/src/pages/AuctionDetailPage.tsx:120-168` | 中 | 否 |

## Phase 2 — GitHub Issue Search Results (upstream items only)

| # | 坑描述 | 嚴重度 | 目標 Repo | 已有 Issue？ | 建議動作 |
|---|--------|--------|-----------|-------------|---------|
| 1 | WASM dual-instantiation（monorepo 跨目錄解析出兩份 WASM 實例，需 `resolve.dedupe`） | 高 | midnightntwrk/midnight-js | 無重複 | 🆕 提交新 Issue（"WASM dual-instantiation across monorepo boundary requires `resolve.dedupe` workaround in Vite"） |
| 2 | vite-plugin-wasm 型別宣告與 runtime export 不符 | 低 | Menci/vite-plugin-wasm（第三方） | 未搜尋 | ⏭️ 跳過（第三方 / 非 Midnight scope） |
| 4 | ShieldedWallet genesis sync 進入 retry-loop 洩漏 WASM 記憶體，可撞爆機器 | 高 | midnightntwrk/midnight-js | 無重複 | 🆕 提交新 Issue（"ShieldedWallet genesis-sync retry-loop leaks WASM linear memory, can crash host (~11GB observed)"） |
| 5 | Deploy 交易過大被公開 RPC 以 `1016 Immediately Dropped` 拒絕 | 高 | midnightntwrk/midnight-js、midnight-node | 部分相關（midnight-node#1150，非完全符合） | 🆕 提交新 Issue（"contractDeploy transaction exceeds public RPC size limit → 1016 Immediately Dropped, with no actionable error"） |
| 6 | `balanceUnboundTransaction` 部分 SDK 版本不自動簽署 unshielded intent | 中高 | midnightntwrk/midnight-js | 無重複 | 🆕 提交新 Issue（"balanceUnboundTransaction does not sign unshielded offer intents in some SDK versions"） |
| 7 | Compact 缺乏可安全使用的 on-chain 時間斷言 | 高 | midnightntwrk/compact | **有，`#20`（open）**「`kernel.blockTimeLessThan` bricks deployed contract」——Compact 其實有時間原語，但用了會讓合約損毀 | 💬 補充留言到既有 Issue（https://github.com/midnightntwrk/compact/issues/20） |
| 8 | Lace 宣告支援 `getProvingProvider` 但執行期丟 `TypeError` | 高 | midnightntwrk/midnight-js | 無重複（`#763` 背景相關但非重複） | 🆕 提交新 Issue（"getProvingProvider() throws TypeError at runtime for wallets that declare support but don't implement it (e.g. Lace)"） |
| 10 | `dapp-connector-api` 的 `balanceUnsealedTransaction` 沒有 `ttl` 參數 | 低 | midnightntwrk/midnight-js | 無重複 | 🆕 提交新 Issue（"ConnectedAPI.balanceUnsealedTransaction has no ttl parameter — caller-supplied TTL is silently dropped"） |

### 搜尋方法備註

- 搜尋工具：GitHub Search Issues API（經 `gh api` 認證呼叫，避免未認證的低速率限制）
- 每個項目依序用 2-3 組關鍵字搜尋，對疑似相關結果（如 midnight-node#1150、midnight-js#763、midnight-js#1025、midnight-js#734）額外抓取完整 issue body 確認是否真的符合，非僅憑標題判斷
- 項目 #3、#9、#11、#12 為本專案內部問題，非上游 bug，不需要對外提交 Issue

## Non-upstream items (project-internal, no external issue needed)

| # | 坑描述 | 嚴重度 | 建議動作 |
|---|--------|--------|---------|
| 3 | Vite workspace-root 自動偵測擋掉 contract 目錄請求 | 低 | 本專案自行修復（已修復，`server.fs.allow`） |
| 9 | 前端硬編碼 `BIDDER1_STATE_ID`，`BIDDER2_STATE_ID` 從未在 UI 使用，註解與行為不一致 | 中 | 本專案自行修復（更新註解或補上角色切換 UI） |
| 11 | 多處 `as any` 型別不安全點 | 低 | 本專案自行修復（視情況收斂型別） |
| 12 | 缺少 loading state、錯誤被靜默吞掉 | 中 | 本專案自行修復（加上 isLoading 旗標與可見錯誤訊息） |
