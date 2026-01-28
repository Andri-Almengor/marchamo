import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import crypto from "crypto";
import QRCode from "qrcode";
import { db } from "./db";

// =========================
// Tipos de filas (SQLite)
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
function normalizePlaca(input: string) {
  return String(input || "").trim().toUpperCase();
}

function safeJsonParse(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// =========================
// QR Token (HMAC, SIN expiración)
// token = base64url(PLACA) + "." + HMAC(PLACA)
// =========================
const QR_SECRET = process.env.QR_SECRET || "dev_secret_change_me";
const FRONT_URL = process.env.FRONT_URL || "http://localhost:5173";

function base64url(input: Buffer | string) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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
  const payload = placa;
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

  return { placa };
}

// =========================
// App
// =========================
const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 3002);

// =========================
// Health
// =========================
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    db: "sqlite",
    timestamp: new Date().toISOString()
  });
});

// =========================
// Consulta normal por placa
// =========================
app.get("/consulta/:placa", (req: Request, res: Response) => {
  const placa = normalizePlaca(String(req.params.placa ?? ""));
  if (!placa) return res.status(400).json({ message: "Placa requerida" });

  try {
    const vehiculo = db
      .prepare("SELECT * FROM vehiculos WHERE placa = ?")
      .get(placa) as VehiculoRow | undefined;

    if (!vehiculo) {
      return res.status(404).json({ message: "Vehículo no encontrado" });
    }

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

    return res.json({
      placa: vehiculo.placa,
      marca: vehiculo.marca,
      modelo: vehiculo.modelo,
      anio: vehiculo.anio,
      color: vehiculo.color,
      tipo: vehiculo.tipo,
      numero_chasis: vehiculo.numero_chasis,
      caracteristicas: safeJsonParse(vehiculo.caracteristicas),
      ultimo_marchamo: marchamo ?? null,
      ultima_revision: revision ?? null
    });
  } catch (err: unknown) {
    console.error("Error /consulta/:placa ->", err);
    return res.status(500).json({
      message: "Error interno consultando la base",
      detail: err instanceof Error ? err.message : String(err)
    });
  }
});

// =========================
// Generar QR (PNG) por placa
// =========================
app.get("/qr/:placa.png", (req: Request, res: Response) => {
  const placa = normalizePlaca(String(req.params.placa ?? ""));
  if (!placa) return res.status(400).send("Placa requerida");

  try {
    const exists = db
      .prepare("SELECT id FROM vehiculos WHERE placa = ?")
      .get(placa) as { id: number } | undefined;

    if (!exists) return res.status(404).send("Vehículo no encontrado");

    const token = makeQrToken(placa);
    const url = `${FRONT_URL}/qr/${token}`;

    res.setHeader("Content-Type", "image/png");
    QRCode.toFileStream(res, url, {
      type: "png",
      margin: 2,
      width: 360,
      errorCorrectionLevel: "M"
    });
  } catch (err: unknown) {
    console.error("Error /qr/:placa.png ->", err);
    return res.status(500).send("Error generando QR");
  }
});

// =========================
// Info por token (solo placa)
// =========================
app.get("/qr/info/:token", (req: Request, res: Response) => {
  const token = String(req.params.token ?? "");
  const verified = verifyQrToken(token);

  if (!verified) {
    return res.status(401).json({ message: "QR inválido" });
  }

  return res.json({
    placa: normalizePlaca(verified.placa)
  });
});

// =========================
// Consulta segura por token QR
// =========================
app.get("/qr/lookup/:token", (req: Request, res: Response) => {
  const token = String(req.params.token ?? "");
  const verified = verifyQrToken(token);

  if (!verified) {
    return res.status(401).json({ message: "QR inválido" });
  }

  const placa = normalizePlaca(verified.placa);

  try {
    const vehiculo = db
      .prepare("SELECT * FROM vehiculos WHERE placa = ?")
      .get(placa) as VehiculoRow | undefined;

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

    return res.json({
      placa: vehiculo.placa,
      marca: vehiculo.marca,
      modelo: vehiculo.modelo,
      anio: vehiculo.anio,
      color: vehiculo.color,
      tipo: vehiculo.tipo,
      numero_chasis: vehiculo.numero_chasis,
      caracteristicas: safeJsonParse(vehiculo.caracteristicas),
      ultimo_marchamo: marchamo ?? null,
      ultima_revision: revision ?? null
    });
  } catch (err: unknown) {
    console.error("Error /qr/lookup/:token ->", err);
    return res.status(500).json({
      message: "Error interno consultando por QR",
      detail: err instanceof Error ? err.message : String(err)
    });
  }
});

// =========================
// Start
// =========================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend corriendo en http://localhost:${PORT}`);
});
