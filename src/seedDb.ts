import type Database from "better-sqlite3";

export function seedDb(db: Database.Database) {
  const count = db.prepare("SELECT COUNT(*) as c FROM vehiculos").get() as { c: number };
  if (count.c > 0) return;

  const insertVehiculo = db.prepare(`
    INSERT INTO vehiculos (placa, marca, modelo, anio, color, tipo, caracteristicas, numero_chasis)
    VALUES (@placa, @marca, @modelo, @anio, @color, @tipo, @caracteristicas, @numero_chasis)
  `);

  const insertMarchamo = db.prepare(`
    INSERT INTO marchamos (vehiculo_id, anio_validez, monto, estado)
    VALUES (?, ?, ?, ?)
  `);

  const insertRevision = db.prepare(`
    INSERT INTO revisiones_vehiculares (vehiculo_id, anio_validez, resultado, observaciones)
    VALUES (?, ?, ?, ?)
  `);

  const vehiculos = [
    {
      placa: "ABC123",
      marca: "Toyota",
      modelo: "Corolla",
      anio: 2018,
      color: "Blanco",
      tipo: "Carro",
      caracteristicas: JSON.stringify({ transmision: "Automática", combustible: "Gasolina" }),
      numero_chasis: "JTDBR32E123456789"
    },
    {
      placa: "DEF456",
      marca: "Hyundai",
      modelo: "Tucson",
      anio: 2020,
      color: "Gris",
      tipo: "Carro",
      caracteristicas: JSON.stringify({ traccion: "AWD", airbags: 6 }),
      numero_chasis: "KM8J3CA46LU123456"
    },
    {
      placa: "MOT404",
      marca: "Honda",
      modelo: "CBR 250R",
      anio: 2016,
      color: "Rojo",
      tipo: "Moto",
      caracteristicas: JSON.stringify({ cilindrada: "250cc" }),
      numero_chasis: "MLHMC4123G5123456"
    }
  ];

  const tx = db.transaction(() => {
    for (const v of vehiculos) {
      const info = insertVehiculo.run(v);
      const id = Number(info.lastInsertRowid);

      insertMarchamo.run(id, 2026, 95000, "Vigente");
      insertRevision.run(id, 2026, "Aprobado", "Sin observaciones");
    }
  });

  tx();
}
