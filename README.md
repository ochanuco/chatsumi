# chatsumi

外のデータを摘んでくる窓口。docker01 で動くコンテナで、yunomi から Cloudflare Tunnel + Access 越しに HTTP で呼ばれる。

- `fetchText`: URL のタイトルと本文テキストを返す
- `listRecent`: Miniflux の新着を返す
- Miniflux の webhook を受け、新着を地区で振り分けて Discord に送る。振り分けの規則は D1 から読む（[ADR-0001](docs/adr/0001-read-area-rules-from-d1.md)、[ADR-0002](docs/adr/0002-route-miniflux-entries-to-discord.md)）

計画は [docs/plan/](docs/plan/)、配置は `ochanuco/chabatake` の `docker01/chatsumi/` にある。

## API

`/healthz` と `/webhooks/miniflux` 以外は Cloudflare Access の JWT（`Cf-Access-Jwt-Assertion`）を検証する。`/webhooks/miniflux` は Miniflux の署名（`X-Miniflux-Signature`）で確かめる。

```sh
curl -X POST localhost:8080/fetchText -H 'content-type: application/json' \
  -H "Cf-Access-Jwt-Assertion: $TOKEN" -d '{"url":"https://example.com/"}'
```

入力と応答の形は [docs/plan/chatsumi-plan.md](docs/plan/chatsumi-plan.md) にある。

## 環境変数

| 名前                       | 必須 | 内容                                                                                              |
| -------------------------- | ---- | ------------------------------------------------------------------------------------------------- |
| `CF_ACCESS_TEAM_DOMAIN`    | ○    | Access のチームドメイン（`<team>.cloudflareaccess.com`）                                          |
| `CF_ACCESS_AUD`            | ○    | Access の Application の AUD                                                                      |
| `BROWSER_CDP_URL`          |      | 共有ブラウザの CDP（docker01 では `ws://host.docker.internal:3000`）。なければ browser を使わない |
| `BROWSER_MAX_CONCURRENCY`  |      | browser の同時実行数（既定 2）                                                                    |
| `SSRF_EXTRA_BLOCKED_CIDRS` |      | 追加で拒否する CIDR（カンマ区切り）。宅内の公開アドレスなど                                       |
| `MAX_TEXT_CHARS`           |      | 本文の切り詰めの長さ（既定 20000）                                                                |
| `USER_AGENT`               |      | http の取得の User-Agent                                                                          |
| `PORT`                     |      | 待ち受けのポート（既定 8080）                                                                     |

### 地区の振り分けと Discord への通知

`MINIFLUX_WEBHOOK_SECRET` があるときだけ使う。あるときは、ほかの変数もすべて要る。

| 名前                        | 内容                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `MINIFLUX_WEBHOOK_SECRET`   | Miniflux の webhook の秘密の鍵                                                                                                               |
| `AREA_MAPS_D1_ACCOUNT_ID`   | 規則の D1 がある Cloudflare のアカウント                                                                                                     |
| `AREA_MAPS_D1_DATABASE_ID`  | 規則の D1 の database                                                                                                                        |
| `AREA_MAPS_D1_API_TOKEN`    | D1 を読む API トークン（D1 Read で足りる）                                                                                                   |
| `AREA_MAPS_REFRESH_SECONDS` | 規則を読み直す間隔（既定 300 秒）                                                                                                            |
| `DISCORD_WEBHOOKS`          | 通知先の名前から Discord の webhook の URL への JSON（`{"name":"https://discord.com/api/webhooks/..."}`）。スレッドは `?thread_id=` を付ける |

### 規則の形

D1 の database `chatsumi` の `area_maps` に、feed ごとに 1 行で置く。database と表は `wrangler.jsonc` と `migrations/` が持ち、表を変えたら `pnpm d1:migrate` で流す。chatsumi は Worker ではないので、wrangler はこのためだけに使う。

```sql
CREATE TABLE area_maps (
  feed_id    TEXT PRIMARY KEY,
  doc        TEXT NOT NULL CHECK (json_valid(doc)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

```json
{
	"miniflux_feed_ids": [7],
	"default": { "tag": "area:other", "label": "その他" },
	"areas": [
		{ "tag": "area:minato", "label": "みなと", "aliases": ["みなと", "湊"] }
	],
	"exclude": ["西町駅"],
	"routes": { "area:minato": "minato", "area:other": "other" }
}
```

- 見出しと本文の冒頭 300 文字を NFKC でそろえ、別名と文字列で突き合わせる。重なる一致は長い語が勝ち、見出しで決まればそれを、決まらなければ本文で先に出た別名を採る
- `exclude` の語は地区を決めない。別名を含むが別の場所を指す語（隣の市の駅名など）を置く
- どの別名にも当たらない記事は `default` の地区になる。`routes` に送り先の無い地区の記事は送らない
- `routes` の値は `DISCORD_WEBHOOKS` の名前。URL は D1 に置かない

## 開発

```sh
pnpm install
pnpm dev
pnpm typecheck && pnpm lint && pnpm test
```
