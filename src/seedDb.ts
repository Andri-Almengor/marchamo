import type Database from "better-sqlite3";

export function seedDb(db: Database.Database) {
  const count = db.prepare("SELECT COUNT(*) as c FROM vehiculos").get() as { c: number };
  if (count.c > 0) {
    console.log("DB ya tiene datos, seed omitido");
    return;
  }

  console.log("Insertando datos de prueba...");

  const insertVehiculo = db.prepare(`
    INSERT INTO vehiculos
    (placa, marca, modelo, anio, color, tipo, caracteristicas, numero_chasis)
    VALUES
    (@placa, @marca, @modelo, @anio, @color, @tipo, @caracteristicas, @numero_chasis)
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
    // ===== CARROS =====
    { placa: "ABC123", marca: "Toyota", modelo: "Corolla", anio: 2018, color: "Blanco", tipo: "Carro",
      caracteristicas: { transmision: "Automática", combustible: "Gasolina" },
      chasis: "JTDBR32E123456789" },

    { placa: "DEF456", marca: "Hyundai", modelo: "Elantra", anio: 2019, color: "Gris", tipo: "Carro",
      caracteristicas: { transmision: "Manual", combustible: "Gasolina" },
      chasis: "KMHD84LF9KU123456" },

    { placa: "GHI789", marca: "Nissan", modelo: "Sentra", anio: 2020, color: "Azul", tipo: "Carro",
      caracteristicas: { airbags: 6, abs: true },
      chasis: "3N1AB7AP0LY234567" },

    { placa: "JKL321", marca: "Kia", modelo: "Sportage", anio: 2021, color: "Negro", tipo: "Carro",
      caracteristicas: { traccion: "AWD", combustible: "Gasolina" },
      chasis: "KNDPMCAC5M7890123" },

    { placa: "MNO654", marca: "Mazda", modelo: "CX-5", anio: 2022, color: "Rojo", tipo: "Carro",
      caracteristicas: { motor: "2.5L", transmision: "Automática" },
      chasis: "JM3KFBDM0N0123456" },

    { placa: "PQR987", marca: "Chevrolet", modelo: "Onix", anio: 2017, color: "Plata", tipo: "Carro",
      caracteristicas: { combustible: "Gasolina" },
      chasis: "9BGKS48T0HG123456" },

    { placa: "STU147", marca: "Ford", modelo: "Escape", anio: 2019, color: "Verde", tipo: "Carro",
      caracteristicas: { traccion: "4x4" },
      chasis: "1FMCU9HD2KUA12345" },

    { placa: "VWX258", marca: "Volkswagen", modelo: "Jetta", anio: 2018, color: "Gris", tipo: "Carro",
      caracteristicas: { motor: "1.4 TSI" },
      chasis: "3VW2B7AJ5JM123456" },

    { placa: "YZA369", marca: "Honda", modelo: "Civic", anio: 2020, color: "Negro", tipo: "Carro",
      caracteristicas: { modoEco: true },
      chasis: "2HGFC2F69LH123456" },

    { placa: "BCD741", marca: "Subaru", modelo: "Forester", anio: 2021, color: "Blanco", tipo: "Carro",
      caracteristicas: { traccion: "AWD", eyesight: true },
      chasis: "JF2SKAJC2MH123456" },

    // ===== MOTOS =====
    { placa: "MOT101", marca: "Honda", modelo: "XR150L", anio: 2017, color: "Rojo", tipo: "Moto",
      caracteristicas: { cilindrada: "150cc" },
      chasis: "MLHXR1517H5123456" },

    { placa: "MOT202", marca: "Yamaha", modelo: "FZ25", anio: 2019, color: "Azul", tipo: "Moto",
      caracteristicas: { cilindrada: "250cc" },
      chasis: "ME1RG4711K2123456" },

    { placa: "MOT303", marca: "Suzuki", modelo: "GSX-R150", anio: 2020, color: "Azul", tipo: "Moto",
      caracteristicas: { deportiva: true },
      chasis: "JS1BK1110L2123456" },

    { placa: "MOT404", marca: "Kawasaki", modelo: "Ninja 400", anio: 2021, color: "Verde", tipo: "Moto",
      caracteristicas: { cilindrada: "400cc" },
      chasis: "JKAEX8A18MDA12345" },

    { placa: "MOT505", marca: "Honda", modelo: "CBR250R", anio: 2016, color: "Negro", tipo: "Moto",
      caracteristicas: { abs: true },
      chasis: "MLHMC4123G5123456" }
  ];

  const tx = db.transaction(() => {
    for (const v of vehiculos) {
      const info = insertVehiculo.run({
        placa: v.placa,
        marca: v.marca,
        modelo: v.modelo,
        anio: v.anio,
        color: v.color,
        tipo: v.tipo,
        caracteristicas: JSON.stringify(v.caracteristicas),
        numero_chasis: v.chasis
      });

      const vehiculoId = Number(info.lastInsertRowid);

      insertMarchamo.run(
        vehiculoId,
        2026,
        v.tipo === "Moto" ? 45000 : 95000,
        "Vigente"
      );

      insertRevision.run(
        vehiculoId,
        2026,
        "Aprobado",
        "Sin observaciones"
      );
    }
  });

  tx();
  console.log("Seed completado con éxito");
}
