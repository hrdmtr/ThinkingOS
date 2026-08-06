import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "./schema.js";

let db: Database.Database | undefined;

/**
 * 既存のnodesテーブルに古いCHECK制約（'根拠'を含み'事実'を含まない6分類）が
 * 残っている場合、制約なしの新しいテーブルに作り替える。'根拠'だった行は
 * '事実'に読み替える（PDMレビュー: 「根拠」はtypeからエッジラベルへ移行したため）。
 * CREATE TABLE IF NOT EXISTSは既存テーブルを一切変更しないため、
 * このワンタイム移行がなければ古い制約でINSERT/UPDATEが失敗し続ける。
 */
function migrateNodesTableIfNeeded(db: Database.Database): void {
  const existing = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'nodes'")
    .get() as { sql: string } | undefined;

  if (!existing || !existing.sql.includes("CHECK")) {
    return; // テーブルが存在しない（新規）か、既に移行済み
  }

  const wasForeignKeysOn = (db.pragma("foreign_keys", { simple: true }) as number) === 1;
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE nodes_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          session_id INTEGER NOT NULL REFERENCES sessions(id)
        );
      `);
      db.exec(`
        INSERT INTO nodes_new (id, type, content, created_at, session_id)
        SELECT id, CASE WHEN type = '根拠' THEN '事実' ELSE type END, content, created_at, session_id
        FROM nodes;
      `);
      db.exec(`DROP TABLE nodes;`);
      db.exec(`ALTER TABLE nodes_new RENAME TO nodes;`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_session_id ON nodes(session_id);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);`);
    })();
  } finally {
    if (wasForeignKeysOn) db.pragma("foreign_keys = ON");
  }
}

/**
 * 既存のsessionsテーブルにcontinued_from_session_idカラムがなければ追加する。
 * CHECK制約の移行と違い単純なカラム追加のため、ALTER TABLE ADD COLUMNで足りる
 * （テーブルの作り替えは不要）。
 */
function migrateSessionsTableIfNeeded(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
  if (columns.length === 0) return; // テーブルが存在しない（新規）

  const hasColumn = columns.some((c) => c.name === "continued_from_session_id");
  if (!hasColumn) {
    db.exec(
      "ALTER TABLE sessions ADD COLUMN continued_from_session_id INTEGER REFERENCES sessions(id)",
    );
  }
}

/**
 * 既存のnodesテーブルにtagsカラムがなければ追加する。「気づき」タグ機能
 * （PDMレビュー済み: typeを7分類に増やすのではなく直交する別軸で表現する）への対応。
 * sessionsのcontinued_from_session_id追加と同じくALTER TABLE ADD COLUMNで足りる。
 */
function migrateNodesTagsColumnIfNeeded(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(nodes)").all() as { name: string }[];
  if (columns.length === 0) return; // テーブルが存在しない（新規）

  const hasColumn = columns.some((c) => c.name === "tags");
  if (!hasColumn) {
    db.exec("ALTER TABLE nodes ADD COLUMN tags TEXT NOT NULL DEFAULT ''");
  }
}

export function getDb(): Database.Database {
  if (db) return db;

  const path = process.env.DATABASE_PATH ?? "./data/thinkingos.sqlite";
  mkdirSync(dirname(path), { recursive: true });

  db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrateNodesTableIfNeeded(db);
  migrateSessionsTableIfNeeded(db);
  migrateNodesTagsColumnIfNeeded(db);
  db.exec(SCHEMA_SQL);

  return db;
}

/** テスト用途。本番プロセスの通常フローでは呼ばない。 */
export function closeDb(): void {
  db?.close();
  db = undefined;
}
