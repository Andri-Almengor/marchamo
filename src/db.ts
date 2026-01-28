import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// 1) Permite override por env var (ideal para Render Disk en el futuro)
const DB_PATH =
  process.env.DB_PATH ||
  path.join(process.cwd(), "database", "marchamo.db");

// 2) Asegurar que exista la carpeta "database/"
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(DB_PATH, {
  readonly: false
});

// (Opcional) mejorar estabilidad
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

console.log("SQLite DB_PATH =>", DB_PATH);
