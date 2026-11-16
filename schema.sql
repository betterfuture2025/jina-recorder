-- 지나기록기 — 상담·회의 녹음 기록 — DB 구조 (Cloudflare D1)
-- 전체 파트에서 쓸 테이블을 처음부터 만들어 둔다. 여러 번 실행해도 안전하다.

PRAGMA foreign_keys = ON;

-- 선생님·관리자. 여기 등록된 지메일만 로그인할 수 있다.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('teacher', 'admin')),
  active        INTEGER NOT NULL DEFAULT 1,
  picture       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- 로그인 상태 (토큰 원문은 저장하지 않고 해시만 저장)
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 설정 페이지 값. is_secret = 1 이면 value 는 암호화되어 있다.
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  is_secret   INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by  TEXT
);

-- 학부모·아이·고객 등 상대방
CREATE TABLE IF NOT EXISTS contacts (
  id                  TEXT PRIMARY KEY,
  kind                TEXT NOT NULL DEFAULT 'parent' CHECK (kind IN ('parent', 'child', 'customer', 'staff', 'other')),
  name                TEXT NOT NULL,
  phone               TEXT,
  email               TEXT,
  related_child_id    TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  relation            TEXT,            -- 예: 어머님, 아버님
  note                TEXT,
  created_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);

-- 녹음 한 건
CREATE TABLE IF NOT EXISTS recordings (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT NOT NULL REFERENCES users(id),
  kind           TEXT NOT NULL DEFAULT 'unassigned' CHECK (kind IN ('memo', 'meeting', 'consult', 'unassigned')),
  title          TEXT,
  status         TEXT NOT NULL DEFAULT 'recording' CHECK (status IN ('recording', 'processing', 'done', 'failed')),
  started_at     TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at       TEXT,
  duration_sec   INTEGER,
  consent        INTEGER NOT NULL DEFAULT 0,
  consent_at     TEXT,
  audio_key      TEXT,                 -- R2 위치
  drive_file_id  TEXT,                 -- 구글 드라이브로 옮긴 경우
  ncmg_exported_at TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recordings_owner_time ON recordings(owner_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_time ON recordings(started_at DESC);

-- 녹음 ↔ 상대방·참석자
CREATE TABLE IF NOT EXISTS participants (
  id            TEXT PRIMARY KEY,
  recording_id  TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  contact_id    TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT,
  CHECK (contact_id IS NOT NULL OR user_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_participants_rec ON participants(recording_id);
CREATE INDEX IF NOT EXISTS idx_participants_contact ON participants(contact_id);

-- 녹음 조각 (실시간 업로드 단위)
CREATE TABLE IF NOT EXISTS chunks (
  recording_id  TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  r2_key        TEXT NOT NULL,
  start_ms      INTEGER,
  end_ms        INTEGER,
  bytes         INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (recording_id, seq)
);

-- 화자별 문장
CREATE TABLE IF NOT EXISTS segments (
  id            TEXT PRIMARY KEY,
  recording_id  TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  start_ms      INTEGER,
  end_ms        INTEGER,
  speaker       TEXT,
  text          TEXT NOT NULL,
  is_final      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_segments_rec ON segments(recording_id, seq);

-- AI 요약
CREATE TABLE IF NOT EXISTS summaries (
  recording_id  TEXT PRIMARY KEY REFERENCES recordings(id) ON DELETE CASCADE,
  summary       TEXT,
  decisions     TEXT,
  todos         TEXT,
  model         TEXT,
  edited_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 태그
CREATE TABLE IF NOT EXISTS tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS recording_tags (
  recording_id  TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  tag_id        TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source        TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'user')),
  PRIMARY KEY (recording_id, tag_id)
);

-- 이메일 발송 기록
CREATE TABLE IF NOT EXISTS email_log (
  id            TEXT PRIMARY KEY,
  recording_id  TEXT REFERENCES recordings(id) ON DELETE SET NULL,
  to_addr       TEXT NOT NULL,
  status        TEXT NOT NULL,
  provider_id   TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 단어 검색용 색인 (파트 4에서 채움)
CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
  text,
  recording_id UNINDEXED,
  segment_id UNINDEXED,
  tokenize = 'unicode61'
);
