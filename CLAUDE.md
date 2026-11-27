# chatsumi リポジトリ規約

計画の一次情報は `docs/plan/`。実装前に該当する Epic / Issue を確認する。

chatsumi は外のデータを摘んでくる窓口で、状態を持たない。保存とスケジュールは持たず、Miniflux や changedetection.io などの OSS に任せる。例外は 2 つで、Miniflux の新着を地区で振り分けて Discord に送ることと、その振り分けの規則を D1 から読むこと（`docs/adr/`）。この repo はコードと GHCR へのイメージ公開だけを持ち、配置（compose、Tunnel、Access、secret）は `ochanuco/chabatake` の `docker01/chatsumi/` と `cloudflare/` が持つ。

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
- `src/areas/`: 地区の振り分け。`rules.ts`（規則の形と判定）、`d1.ts`（D1 の REST API で規則を読む）、`store.ts`（読み直しとメモリへの保持）
- `src/notify/`: `miniflux.ts`（webhook の署名と本文の形）、`discord.ts`（書式と送信）、`route.ts`（振り分けて送る）
- `src/outbound/post.ts`: 設定で決まる宛先（Cloudflare の API、Discord の webhook）への POST
- イメージは `main` への push で `ghcr.io/ochanuco/chatsumi:{sha-xxxxxxx,main}` に出る。続けて `deploy` job が chabatake の `docker01-app` を dispatch し、その版を docker01 に配置する（`ochanuco/.github` の `actions/chabatake-dispatch`）。Environment `production` の secret `OP_SA_DEPLOY` を使う

## コーディング規約

- type stripping で動かすため、`enum`・`namespace`・パラメータプロパティなど消せない構文は使わない（`erasableSyntaxOnly`）。相対 import は `.ts` まで書く
- Valibot は境界（HTTP の入力、外部 API の応答）でのみ使う。内部の型は TypeScript の型で表す
- ドメインエラーは `type` で判別する discriminated union。想定内の失敗は例外を投げず `Result<T, E>` で返す
- 外へ出る取得は必ず SSRF の検査を通す。検査を通さない `fetch` を足さない。設定で決まる宛先への POST は `src/outbound/post.ts` を使い、許したホストに限って `vetUrl` を通してから送る
- 公開の repo なので、テストや例に実在の地名・フィードを書かない。規則の中身は D1 にだけ置く
- コメントは日本語で、コードから読み取れない理由だけを書く
