# chatsumi

外のデータを摘んでくる窓口。docker01 で動くコンテナで、yunomi から Cloudflare Tunnel + Access 越しに HTTP で呼ばれる。

- `fetchText`: URL のタイトルと本文テキストを返す
- `listRecent`: Miniflux と changedetection.io の新着を同じ形にそろえて返す

計画は [docs/plan/](docs/plan/)、配置は `ochanuco/chabatake` の `docker01/chatsumi/` にある。

## API

`/healthz` 以外は Cloudflare Access の JWT（`Cf-Access-Jwt-Assertion`）を検証する。

```sh
curl -X POST localhost:8080/fetchText -H 'content-type: application/json' \
  -H "Cf-Access-Jwt-Assertion: $TOKEN" -d '{"url":"https://example.com/"}'
```

入力と応答の形は [docs/plan/chatsumi-plan.md](docs/plan/chatsumi-plan.md) にある。

## 環境変数

| 名前 | 必須 | 内容 |
| --- | --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | ○ | Access のチームドメイン（`<team>.cloudflareaccess.com`） |
| `CF_ACCESS_AUD` | ○ | Access の Application の AUD |
| `BROWSER_CDP_URL` | | 共有ブラウザの CDP（docker01 では `ws://host.docker.internal:3000`）。なければ browser を使わない |
| `BROWSER_MAX_CONCURRENCY` | | browser の同時実行数（既定 2） |
| `SSRF_EXTRA_BLOCKED_CIDRS` | | 追加で拒否する CIDR（カンマ区切り）。宅内の公開アドレスなど |
| `MAX_TEXT_CHARS` | | 本文の切り詰めの長さ（既定 20000） |
| `USER_AGENT` | | http の取得の User-Agent |
| `PORT` | | 待ち受けのポート（既定 8080） |

## 開発

```sh
pnpm install
pnpm dev
pnpm typecheck && pnpm lint && pnpm test
```
