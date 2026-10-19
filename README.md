# chatsumi

外のデータを摘んでくる窓口。docker01 で動くコンテナで、yunomi から Cloudflare Tunnel + Access 越しに HTTP で呼ばれる。

- `fetchText`: URL のタイトルと本文テキストを返す
- `listRecent`: Miniflux と changedetection.io の新着を同じ形にそろえて返す

計画は [docs/plan/](docs/plan/)、配置は `ochanuco/chabatake` の `docker01/chatsumi/` にある。

## 開発

```sh
pnpm install
pnpm dev
pnpm typecheck && pnpm lint && pnpm test
```
