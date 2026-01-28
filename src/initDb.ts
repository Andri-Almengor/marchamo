import type Database from "better-sqlite3";

export function initDb(db: Database.Database) {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS vehiculos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      placa TEXT NOT NULL UNIQUE,
      marca TEXT NOT NULL,
      modelo TEXT NOT NULL,
      anio INTEGER NOT NULL,
      color TEXT,
      tipo TEXT,
      caracteristicas TEXT,
      numero_chasis TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS marchamos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehiculo_id INTEGER NOT NULL,
      anio_validez INTEGER NOT NULL,
      monto REAL,
      estado TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS revisiones_vehiculares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehiculo_id INTEGER NOT NULL,
      anio_validez INTEGER NOT NULL,
      resultado TEXT,
      observaciones TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id) ON DELETE CASCADE
      
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ux_vehiculos_placa ON vehiculos(placa);

  `);
}
