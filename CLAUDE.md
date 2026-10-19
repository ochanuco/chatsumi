# chatsumi リポジトリ規約

計画の一次情報は `docs/plan/`。実装前に該当する Epic / Issue を確認する。

chatsumi は外のデータを摘んでくる窓口で、状態を持たない。保存、スケジュール、通知は持たず、Miniflux や changedetection.io などの OSS に任せる。この repo はコードと GHCR へのイメージ公開だけを持ち、配置（compose、Tunnel、Access、secret）は `ochanuco/chabatake` の `docker01/chatsumi/` と `cloudflare/` が持つ。

## コマンド

- `pnpm install`
- `pnpm typecheck && pnpm lint && pnpm test`: PR 前に必ず通す
- `pnpm dev`: ローカルで起動（環境変数は README）
- `CHATSUMI_TEST_CHROME=<Chrome の実行ファイル> pnpm test`: 実ブラウザでのテストも動かす（CI では飛ばす）
- `pnpm format`: Biome で整形（lint も Biome）

## 構成

- `src/main.ts`: 起動とシグナル処理だけを持つ。ビルドせず Node 24 の type stripping で実行する
- `src/app.ts`: Hono の HTTP API。Access の JWT の検証、入力の検証、ログ。`src/api.ts` が API の型と入力のスキーマを持つ
- `src/config.ts`: 環境変数の読み込みと検証。不正なら起動しない
- `src/fetch/`: 取得。`ssrf.ts`（宛先の検査）、`http.ts`（検査つきの http の取得）、`browser.ts`（共有ブラウザでの取得）、`classify.ts`（ステータスと challenge の分類）、`fetchText.ts`（組み立てと mode の切り替え）
- `src/extract/`: 文字コードの判定、タイトルと本文の取り出し、切り詰め
- イメージは `main` への push で `ghcr.io/ochanuco/chatsumi:{sha-xxxxxxx,main}` に出る。本番のタグは chabatake 側の Renovate が上げる

## コーディング規約

- type stripping で動かすため、`enum`・`namespace`・パラメータプロパティなど消せない構文は使わない（`erasableSyntaxOnly`）。相対 import は `.ts` まで書く
- Valibot は境界（HTTP の入力、外部 API の応答）でのみ使う。内部の型は TypeScript の型で表す
- ドメインエラーは `type` で判別する discriminated union。想定内の失敗は例外を投げず `Result<T, E>` で返す
- 外へ出る取得は必ず SSRF の検査を通す。検査を通さない `fetch` を足さない
- コメントは日本語で、コードから読み取れない理由だけを書く
