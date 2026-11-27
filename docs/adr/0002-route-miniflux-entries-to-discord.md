---

status: accepted
date: 2026-11-27
decision-makers:

- ochanuco

---

# Miniflux の新着を chatsumi が地区で振り分けて Discord に送る

## 要約

地域ニュースの新着を地区ごとに Discord へ知らせる道について、Miniflux の webhook を chatsumi が受け、地区を判定して地区ごとの Discord の webhook に送る形を選び、Miniflux の連携だけで送る案と、changedetection.io の通知も chatsumi に集める案を退けた。地区での振り分けを 1 か所で行い、changedetection.io の通知の機能を捨てないためで、chatsumi が通知を持つことと、chatsumi が止まっている間の新着を知らせ損ねることは受け入れる。

## 背景と課題

ADR-0001 で、記事を地区に振り分ける規則を chatsumi が読めるようにした。振り分けた新着は、地区ごとの Discord のチャンネルやスレッドで読みたい。

Miniflux はフィードの取得と保存を受け持つが、記事の中身で地区を判定する仕組みは持たない。Miniflux の REST API にも、記事 1 件ごとにタグやカテゴリを書き込む口は無い（`PUT /v1/entries/{id}` で直せるのは `title` と `content` だけ）。Miniflux の中で地区を付けて、Miniflux から送り分けることはできない。

一方、Miniflux には利用者ごとの webhook がある。新着を見つけると `new_entries` のイベントで、feed と記事の一覧（見出し、URL、本文の HTML）を POST する。要求には、本文を秘密の鍵で HMAC-SHA256 にかけた `X-Miniflux-Signature` が付く。送信に失敗しても再送はしない。

ページの見張り（changedetection.io）は、今も Discord に直接通知している。見張り先は検索の条件で地区ごとに分けてあるので、通知の時点で振り分けは済んでいる。

## 検討した選択肢

1. Miniflux の連携だけで Discord に送る
2. Miniflux の webhook を chatsumi が受け、地区を判定して Discord に送る
3. 2 に加えて、changedetection.io の通知も chatsumi を通す

## 決定

選択肢 2 を選ぶ。

- chatsumi に、Miniflux の webhook を受ける口を足す。`X-Miniflux-Signature` を確かめ、合わない要求は捨てる
- 受けた記事を ADR-0001 の表で地区に振り分け、表に書かれた地区ごとの通知先に送る。表に載っていない feed の記事は送らない
- changedetection.io は、今のまま Discord に直接通知する
- Miniflux は再送しないので、chatsumi は送った記事を覚えない。同じ記事が二度届くことはない

### 結果

- 良い点: 地区の判定と送り先の選択が、chatsumi の 1 か所にまとまる
- 良い点: chatsumi は webhook を受けて送るだけで、スケジュールも保存も持たない
- 良い点: changedetection.io の差分の表示やフィルタは、そのまま使える
- 悪い点: chatsumi が通知を持つ。計画にあった「通知は持たない」を外れる
- 悪い点: chatsumi が止まっている間に Miniflux が見つけた新着は、Discord に届かない。Miniflux には残るので、読み損ねにはならない
- 悪い点: Discord への通知が、Miniflux からは chatsumi 経由、changedetection.io からは直接と、2 つの道に分かれる

## 選択肢ごとの良い点と悪い点

- Miniflux の連携だけ: chatsumi に何も足さずに済むが、地区で送り先を分けられない
- changedetection.io も通す: 通知の道が 1 本になるが、changedetection.io の通知の書式や条件を chatsumi で作り直すことになる。見張り先はもともと地区ごとに分けてあるので、通しても振り分けの得が無い
