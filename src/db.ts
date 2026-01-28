import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(__dirname, "../../database/marchamo.db");

export const db = new Database(dbPath, {
  readonly: false
});
