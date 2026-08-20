-- events:append-only 事件日志(arch-brief §4 事件溯源;I5/I6 的底座)。
-- 幂等 DDL:应用启动与测试建库共用(DECISIONS.md D2:PG 从第一天起)。
-- 注意:seq/ts 由日志层分配 —— 时钟是 capability,引擎事件(EngineEvent)不含二者。

CREATE TABLE IF NOT EXISTS events (
  seq       BIGSERIAL PRIMARY KEY,
  ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor     TEXT,
  principal TEXT,
  channel   TEXT,
  kind      TEXT NOT NULL,
  rel       TEXT,
  action    TEXT,
  params    JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason    TEXT,
  detail    JSONB
);

CREATE INDEX IF NOT EXISTS events_seq_asc ON events (seq);

-- append-only 强制:行级触发器拒绝 UPDATE/DELETE。
-- TRUNCATE 不触发行级触发器,保留为测试/运维清库口(测试自清理依赖它)。
CREATE OR REPLACE FUNCTION events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'events 表 append-only:禁止 % 于 seq=%', TG_OP, OLD.seq;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS events_append_only_trigger ON events;
CREATE TRIGGER events_append_only_trigger
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION events_append_only();
