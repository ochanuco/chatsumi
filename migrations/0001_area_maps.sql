-- 地区の振り分け規則。feed ごとに 1 行の JSON ドキュメント（形は README の「規則の形」、ADR-0001）
CREATE TABLE area_maps (
  feed_id    TEXT PRIMARY KEY,
  doc        TEXT NOT NULL CHECK (json_valid(doc)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
