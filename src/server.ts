import "dotenv/config";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import crypto from "crypto";
import QRCode from "qrcode";
import { createCanvas, loadImage } from "@napi-rs/canvas";

import { db } from "./db";
import { initDb } from "./initDb";
import { seedDb } from "./seedDb";

initDb(db);
seedDb(db);



// =========================
// Boot DB (una sola vez)
// =========================
initDb(db);
if (String(process.env.SEED_ON_START || "").toLowerCase() === "true") {
  seedDb(db);
  console.log("✅ Seed ejecutado (SEED_ON_START=true)");
}

// =========================
// Types (SQLite rows)
// =========================
type VehiculoRow = {
  id: number;
  placa: string;
  marca: string;
  modelo: string;
  anio: number;
  color: string | null;
  tipo: string | null;
  caracteristicas: string | null; // JSON string
  numero_chasis: string;
  created_at: string;
};

type MarchamoRow = {
  id: number;
  vehiculo_id: number;
  anio_validez: number;
  monto: number | null;
  estado: string | null;
  created_at: string;
};

type RevisionRow = {
  id: number;
  vehiculo_id: number;
  anio_validez: number;
  resultado: string | null;
  observaciones: string | null;
  created_at: string;
};

// =========================
// Helpers
// =========================
function normalizePlaca(input: unknown) {
  return String(input || "").trim().toUpperCase();
}

function nowIso() {
  return new Date().toISOString();
}

function currentYear() {
  return new Date().getFullYear();
}

function safeJsonParse(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** FIX: req.query puede ser string | string[] | undefined */
function getQueryString(q: unknown): string {
  if (Array.isArray(q)) return String(q[0] ?? "");
  return typeof q === "string" ? q : "";
}

function toNullableString(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

// =========================
// QR Token (HMAC, SIN expiración)
// token = base64url(PLACA) + "." + HMAC(PLACA)
// =========================
const QR_SECRET = process.env.QR_SECRET || "dev_secret_change_me";
const FRONT_URL = process.env.FRONT_URL || "http://localhost:5173";

function base64url(input: Buffer | string) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64UrlToString(b64url: string) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (b64.length % 4)) % 4;
  const padded = b64 + "=".repeat(padLen);
  return Buffer.from(padded, "base64").toString("utf8");
}

function sign(payload: string) {
  return base64url(crypto.createHmac("sha256", QR_SECRET).update(payload).digest());
}

function makeQrToken(placa: string) {
  const payload = normalizePlaca(placa);
  const sig = sign(payload);
  return `${base64url(payload)}.${sig}`;
}

function verifyQrToken(token: string): { placa: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const payloadB64 = parts[0];
  const sig = parts[1];

  let placa: string;
  try {
    placa = fromBase64UrlToString(payloadB64);
  } catch {
    return null;
  }

  const expected = sign(placa);

  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }

  return { placa: normalizePlaca(placa) };
}

// =========================
// App
// =========================
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = Number(process.env.PORT || 3002);

// Un handler simple de errores para que el dashboard reciba mensaje consistente
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  console.error("❌ Unhandled error:", err);
  res.status(500).json({ message: "Error interno" });
}

// =========================
// Health
// =========================
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    db: "sqlite",
    front_url: FRONT_URL,
    timestamp: nowIso(),
  });
});

// =========================
// Consulta pública (Front) por placa
// =========================
app.get("/consulta/:placa", (req: Request, res: Response) => {
  const placa = normalizePlaca(req.params.placa);
  if (!placa) return res.status(400).json({ message: "Placa requerida" });

  try {
    const vehiculo = db.prepare("SELECT * FROM vehiculos WHERE placa = ?").get(placa) as
      | VehiculoRow
      | undefined;

    if (!vehiculo) return res.status(404).json({ message: "Vehículo no encontrado" });

    const marchamo = db
      .prepare(
        `
        SELECT * FROM marchamos
        WHERE vehiculo_id = ?
        ORDER BY anio_validez DESC
        LIMIT 1
        `
      )
      .get(vehiculo.id) as MarchamoRow | undefined;

    const revision = db
      .prepare(
        `
        SELECT * FROM revisiones_vehiculares
        WHERE vehiculo_id = ?
        ORDER BY anio_validez DESC
        LIMIT 1
        `
      )
      .get(vehiculo.id) as RevisionRow | undefined;

    res.json({
      placa: vehiculo.placa,
      marca: vehiculo.marca,
      modelo: vehiculo.modelo,
      anio: vehiculo.anio,
      color: vehiculo.color,
      tipo: vehiculo.tipo,
      numero_chasis: vehiculo.numero_chasis,
      caracteristicas: safeJsonParse(vehiculo.caracteristicas),
      ultimo_marchamo: marchamo ?? null,
      ultima_revision: revision ?? null,
    });
  } catch (err) {
    console.error("Error /consulta/:placa ->", err);
    res.status(500).json({ message: "Error interno consultando la base" });
  }
});

// =========================
// Dashboard: listado (con marchamo más reciente)
// =========================
app.get("/vehiculos", (_req: Request, res: Response) => {
  try {
    const rows = db
      .prepare(
        `
        SELECT
          v.id,
          v.placa, v.marca, v.modelo, v.anio, v.tipo, v.color, v.numero_chasis,
          m.anio_validez AS marchamo_anio,
          m.estado AS marchamo_estado
        FROM vehiculos v
        LEFT JOIN marchamos m
          ON m.vehiculo_id = v.id
         AND m.anio_validez = (
           SELECT MAX(m2.anio_validez)
           FROM marchamos m2
           WHERE m2.vehiculo_id = v.id
         )
        ORDER BY v.placa ASC
        `
      )
      .all();

    res.json({ total: rows.length, items: rows });
  } catch (err) {
    console.error("Error /vehiculos ->", err);
    res.status(500).json({ message: "Error listando vehiculos" });
  }
});

// Dashboard: detalle + historial
app.get("/vehiculos/:placa", (req: Request, res: Response) => {
  const placa = normalizePlaca(req.params.placa);
  if (!placa) return res.status(400).json({ message: "Placa requerida" });

  try {
    const vehiculo = db.prepare("SELECT * FROM vehiculos WHERE placa = ?").get(placa) as
      | VehiculoRow
      | undefined;
    if (!vehiculo) return res.status(404).json({ message: "Vehículo no encontrado" });

    const marchamos = db
      .prepare(
        `
        SELECT * FROM marchamos
        WHERE vehiculo_id = ?
        ORDER BY anio_validez DESC, id DESC
        `
      )
      .all(vehiculo.id) as MarchamoRow[];

    const revisiones = db
      .prepare(
        `
        SELECT * FROM revisiones_vehiculares
        WHERE vehiculo_id = ?
        ORDER BY anio_validez DESC, id DESC
        `
      )
      .all(vehiculo.id) as RevisionRow[];

    res.json({
      vehiculo: {
        ...vehiculo,
        caracteristicas: safeJsonParse(vehiculo.caracteristicas),
      },
      marchamos,
      revisiones,
    });
  } catch (err) {
    console.error("GET /vehiculos/:placa ->", err);
    res.status(500).json({ message: "Error obteniendo detalle" });
  }
});

// =========================
// Token por placa (para abrir el front con QR token)
// =========================
app.get("/token/:placa", (req: Request, res: Response) => {
  const placa = normalizePlaca(req.params.placa);
  if (!placa) return res.status(400).json({ message: "Placa requerida" });

  const exists = db.prepare("SELECT 1 FROM vehiculos WHERE placa = ?").get(placa);
  if (!exists) return res.status(404).json({ message: "Vehículo no encontrado" });

  res.json({ placa, token: makeQrToken(placa) });
});

// =========================
// CRUD Dashboard
// =========================
app.post("/vehiculos", (req: Request, res: Response) => {
  try {
    const placa = normalizePlaca(req.body?.placa);
    const marca = String(req.body?.marca || "").trim();
    const modelo = String(req.body?.modelo || "").trim();
    const anio = Number(req.body?.anio);
    const numero_chasis = String(req.body?.numero_chasis || "").trim();

    const tipo = toNullableString(req.body?.tipo);
    const color = toNullableString(req.body?.color);
    const caracteristicas =
      req.body?.caracteristicas !== undefined && req.body.caracteristicas !== null
        ? JSON.stringify(req.body.caracteristicas)
        : null;

    if (!placa || !marca || !modelo || !anio || !numero_chasis) {
      return res.status(400).json({
        message: "Campos requeridos: placa, marca, modelo, anio, numero_chasis",
      });
    }

    const exists = db.prepare("SELECT 1 FROM vehiculos WHERE placa = ?").get(placa);
    if (exists) return res.status(409).json({ message: "Ya existe un vehículo con esa placa" });

    const insertVeh = db.prepare(`
      INSERT INTO vehiculos (placa, marca, modelo, anio, color, tipo, caracteristicas, numero_chasis, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMarch = db.prepare(`
      INSERT INTO marchamos (vehiculo_id, anio_validez, monto, estado, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertRev = db.prepare(`
      INSERT INTO revisiones_vehiculares (vehiculo_id, anio_validez, resultado, observaciones, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      const createdAt = nowIso();
      const info = insertVeh.run(
        placa,
        marca,
        modelo,
        anio,
        color,
        tipo,
        caracteristicas,
        numero_chasis,
        createdAt
      );
      const vehiculoId = Number(info.lastInsertRowid);

      // Opcional marchamo
      if (req.body?.marchamo) {
        const m = req.body.marchamo;
        const anio_validez = Number(m.anio_validez);
        if (anio_validez) {
          insertMarch.run(
            vehiculoId,
            anio_validez,
            m.monto == null ? null : Number(m.monto),
            m.estado ? String(m.estado) : null,
            createdAt
          );
        }
      }

      // Opcional revisión
      if (req.body?.revision) {
        const r = req.body.revision;
        const anio_validez = Number(r.anio_validez);
        if (anio_validez) {
          insertRev.run(
            vehiculoId,
            anio_validez,
            r.resultado ? String(r.resultado) : null,
            r.observaciones ? String(r.observaciones) : null,
            createdAt
          );
        }
      }

      return vehiculoId;
    });

    const id = tx();
    res.status(201).json({ message: "Vehículo creado", placa, id });
  } catch (err) {
    console.error("Error POST /vehiculos ->", err);
    res.status(500).json({ message: "Error creando vehículo" });
  }
});

// Update (edición desde Dashboard). Placa no se cambia.
app.put("/vehiculos/:placa", (req: Request, res: Response) => {
  const placa = normalizePlaca(req.params.placa);
  if (!placa) return res.status(400).json({ message: "Placa requerida" });

  try {
    const veh = db.prepare("SELECT * FROM vehiculos WHERE placa = ?").get(placa) as VehiculoRow | undefined;
    if (!veh) return res.status(404).json({ message: "Vehículo no encontrado" });

    const marca = req.body?.marca != null ? String(req.body.marca).trim() : veh.marca;
    const modelo = req.body?.modelo != null ? String(req.body.modelo).trim() : veh.modelo;
    const anio = req.body?.anio != null ? Number(req.body.anio) : veh.anio;
    const tipo = req.body?.tipo !== undefined ? toNullableString(req.body.tipo) : veh.tipo;
    const color = req.body?.color !== undefined ? toNullableString(req.body.color) : veh.color;
    const numero_chasis =
      req.body?.numero_chasis != null ? String(req.body.numero_chasis).trim() : veh.numero_chasis;

    const caracteristicas =
      req.body?.caracteristicas !== undefined
        ? req.body.caracteristicas == null
          ? null
          : JSON.stringify(req.body.caracteristicas)
        : veh.caracteristicas;

    if (!marca || !modelo || !anio || !numero_chasis) {
      return res.status(400).json({ message: "marca, modelo, anio y numero_chasis no pueden quedar vacíos" });
    }

    db.prepare(`
      UPDATE vehiculos
      SET marca = ?, modelo = ?, anio = ?, tipo = ?, color = ?, numero_chasis = ?, caracteristicas = ?
      WHERE placa = ?
    `).run(marca, modelo, anio, tipo, color, numero_chasis, caracteristicas, placa);

    res.json({ ok: true, message: "Vehículo actualizado" });
  } catch (err) {
    console.error("Error PUT /vehiculos/:placa ->", err);
    res.status(500).json({ message: "Error actualizando vehículo" });
  }
});

app.delete("/vehiculos/:placa", (req: Request, res: Response) => {
  const placa = normalizePlaca(req.params.placa);
  if (!placa) return res.status(400).json({ message: "Placa requerida" });

  try {
    const veh = db.prepare("SELECT id FROM vehiculos WHERE placa = ?").get(placa) as { id: number } | undefined;
    if (!veh) return res.status(404).json({ message: "No existe" });

    // Con FK ON DELETE CASCADE alcanza con borrar vehiculos, pero lo dejamos explícito por claridad.
    db.prepare("DELETE FROM marchamos WHERE vehiculo_id = ?").run(veh.id);
    db.prepare("DELETE FROM revisiones_vehiculares WHERE vehiculo_id = ?").run(veh.id);
    db.prepare("DELETE FROM vehiculos WHERE id = ?").run(veh.id);

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /vehiculos/:placa ->", err);
    res.status(500).json({ message: "Error eliminando" });
  }
});

// Historial: agregar marchamo
app.post("/vehiculos/:placa/marchamo", (req: Request, res: Response) => {
  try {
    const placa = normalizePlaca(req.params.placa);
    const anio_validez = Number(req.body?.anio_validez);
    const monto = req.body?.monto == null ? null : Number(req.body.monto);
    const estado = toNullableString(req.body?.estado);

    if (!placa || !anio_validez) return res.status(400).json({ message: "Requiere placa y anio_validez" });

    const veh = db.prepare("SELECT id FROM vehiculos WHERE placa = ?").get(placa) as { id: number } | undefined;
    if (!veh) return res.status(404).json({ message: "Vehículo no encontrado" });

    db.prepare(`
      INSERT INTO marchamos (vehiculo_id, anio_validez, monto, estado, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(veh.id, anio_validez, monto, estado, nowIso());

    res.status(201).json({ ok: true, message: "Marchamo registrado" });
  } catch (err) {
    console.error("Error POST /vehiculos/:placa/marchamo ->", err);
    res.status(500).json({ message: "Error registrando marchamo" });
  }
});

// Historial: agregar RTV
app.post("/vehiculos/:placa/revision", (req: Request, res: Response) => {
  try {
    const placa = normalizePlaca(req.params.placa);
    const anio_validez = Number(req.body?.anio_validez);
    const resultado = toNullableString(req.body?.resultado);
    const observaciones = toNullableString(req.body?.observaciones);

    if (!placa || !anio_validez) return res.status(400).json({ message: "Requiere placa y anio_validez" });

    const veh = db.prepare("SELECT id FROM vehiculos WHERE placa = ?").get(placa) as { id: number } | undefined;
    if (!veh) return res.status(404).json({ message: "Vehículo no encontrado" });

    db.prepare(`
      INSERT INTO revisiones_vehiculares (vehiculo_id, anio_validez, resultado, observaciones, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(veh.id, anio_validez, resultado, observaciones, nowIso());

    res.status(201).json({ ok: true, message: "Revisión registrada" });
  } catch (err) {
    console.error("Error POST /vehiculos/:placa/revision ->", err);
    res.status(500).json({ message: "Error registrando revisión" });
  }
});

// =========================
// QR simple (PNG) por placa
// =========================
app.get("/qr/:placa.png", (req: Request, res: Response) => {
  const placa = normalizePlaca(req.params.placa);
  if (!placa) return res.status(400).send("Placa requerida");

  try {
    const exists = db.prepare("SELECT 1 FROM vehiculos WHERE placa = ?").get(placa);
    if (!exists) return res.status(404).send("Vehículo no encontrado");

    const token = makeQrToken(placa);
    const url = `${FRONT_URL}/qr/${token}`;

    res.setHeader("Content-Type", "image/png");
    QRCode.toFileStream(res, url, {
      type: "png",
      margin: 2,
      width: 360,
      errorCorrectionLevel: "M",
    });
  } catch (err) {
    console.error("Error /qr/:placa.png ->", err);
    res.status(500).send("Error generando QR");
  }
});

// =========================
// QR “Printable” (PNG con borde + resumen + color)
// /qr-print/:placa.png?color=green|red|orange
// Si no envías color, se auto: rojo si vencido; verde si vigente
// =========================
const COLOR_MAP: Record<string, string> = {
  green: "#22c55e",
  red: "#ef4444",
  orange: "#f59e0b",
};

app.get("/qr-print/:placa.png", async (req: Request, res: Response) => {
  const placa = normalizePlaca(req.params.placa);
  if (!placa) return res.status(400).send("Placa requerida");

  try {
    const vehiculo = db.prepare("SELECT * FROM vehiculos WHERE placa = ?").get(placa) as VehiculoRow | undefined;
    if (!vehiculo) return res.status(404).send("Vehículo no encontrado");

    const marchamo = db
      .prepare(
        `
        SELECT * FROM marchamos
        WHERE vehiculo_id = ?
        ORDER BY anio_validez DESC
        LIMIT 1
        `
      )
      .get(vehiculo.id) as MarchamoRow | undefined;

    const mYear = marchamo?.anio_validez ?? null;
    const expired = mYear != null ? mYear < currentYear() : false;

    const qColor = getQueryString(req.query.color).toLowerCase();
    const borderColor = COLOR_MAP[qColor] || (expired ? COLOR_MAP.red : COLOR_MAP.green);

    const token = makeQrToken(placa);
    const url = `${FRONT_URL}/qr/${token}`;

    const qrDataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 520,
    });

    const qrImg = await loadImage(qrDataUrl);

    // Imagen lista para imprimir (tipo “hoja”)
    const W = 1200;
    const H = 1600;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    // Fondo
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    // Header
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 52px Arial";
    ctx.fillText("QR Vehículo", 70, 110);
    ctx.fillStyle = "#334155";
    ctx.font = "28px Arial";
    ctx.fillText("Escanee para abrir la consulta por placa", 70, 160);

    // Card
    const cardX = 70;
    const cardY = 220;
    const cardW = W - 140;
    const cardH = 1250;

    ctx.fillStyle = "rgba(0,0,0,0.06)";
    ctx.fillRect(cardX + 8, cardY + 10, cardW, cardH);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(cardX, cardY, cardW, cardH);

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 14;
    ctx.strokeRect(cardX + 7, cardY + 7, cardW - 14, cardH - 14);

    // QR
    const qrSize = 720;
    const qrX = cardX + (cardW - qrSize) / 2;
    const qrY = cardY + 90;
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

    // Info
    const infoY = qrY + qrSize + 90;
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 48px Arial";
    ctx.fillText(`Placa: ${vehiculo.placa}`, cardX + 70, infoY);

    ctx.fillStyle = "#334155";
    ctx.font = "34px Arial";
    ctx.fillText(`Marca: ${vehiculo.marca}`, cardX + 70, infoY + 70);
    ctx.fillText(`Modelo: ${vehiculo.modelo}`, cardX + 70, infoY + 120);
    ctx.fillText(`Año: ${vehiculo.anio}`, cardX + 70, infoY + 170);

    const marchamoLabel =
      mYear == null
        ? "Marchamo: Sin datos"
        : expired
          ? `Marchamo: ${mYear} (Vencido)`
          : `Marchamo: ${mYear} (Vigente)`;

    ctx.font = "bold 38px Arial";
    ctx.fillStyle = expired ? "#b91c1c" : "#166534";
    ctx.fillText(marchamoLabel, cardX + 70, infoY + 250);

    // Footer
    ctx.fillStyle = "#64748b";
    ctx.font = "24px Arial";
    ctx.fillText(`Generado: ${new Date().toLocaleString()}`, cardX + 70, cardY + cardH - 60);

    res.setHeader("Content-Type", "image/png");
    res.send(canvas.toBuffer("image/png"));
  } catch (err) {
    console.error("Error /qr-print/:placa.png ->", err);
    res.status(500).send("Error generando QR printable");
  }
});

// =========================
// QR Verify (front usa /qr/:token)
// =========================
app.get("/qr/verify/:token", (req: Request, res: Response) => {
  const token = String(req.params.token || "");
  const parsed = verifyQrToken(token);
  if (!parsed) return res.status(400).json({ message: "Token inválido" });

  const exists = db.prepare("SELECT 1 FROM vehiculos WHERE placa = ?").get(parsed.placa);
  if (!exists) return res.status(404).json({ message: "Vehículo no encontrado" });

  res.json({ ok: true, placa: parsed.placa });
});

// =========================
// Start
// =========================
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 API Marchamo escuchando en http://localhost:${PORT}`);
});
