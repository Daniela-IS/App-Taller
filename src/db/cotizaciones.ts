// Escritura de cotizaciones (Frente B). El monto_total lo recalcula el trigger
// trg_recalc_monto_insert; el stock NO se descuenta aquí (ocurre al aprobar).

import { esUrlImagenValida } from "../utils/validaciones";
import { CotizacionError } from "./cotizacion-error";
import { getDb } from "./database";
import type { TipoItemDetalle } from "./types";

export interface LineaCotizacionInput {
  tipo_item: TipoItemDetalle;
  id_item: number;
  cantidad: number;
  precio_unitario: number;
}

export interface NuevaCotizacionInput {
  id_activo: number;
  id_tipo_documento: number;
  lineas: LineaCotizacionInput[];
  fotos: string[];
}

const MAX_FOTOS = 5;

function invalido(mensaje: string): never {
  throw new CotizacionError("DATOS_INVALIDOS", mensaje);
}

function fechaHoyLocal(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Crea una cotización Pendiente con sus líneas y fotos en una sola transacción.
 * Devuelve el id_cotizacion. Lanza CotizacionError (DATOS_INVALIDOS / STOCK_INSUFICIENTE).
 */
export async function crearCotizacion(
  input: NuevaCotizacionInput,
): Promise<number> {
  const db = getDb();
  let nuevoId = 0;

  await db.withTransactionAsync(async () => {
    // --- a. Validaciones (antes de escribir) ---
    const activo = await db.getFirstAsync<{ id_activo: number }>(
      `SELECT id_activo FROM Activo WHERE id_activo = ?;`,
      [input.id_activo],
    );
    if (!activo) invalido("El activo seleccionado no existe.");

    const tipoDoc = await db.getFirstAsync<{ es_documento_externo: number }>(
      `SELECT es_documento_externo FROM TipoDocumento WHERE id_tipo_documento = ?;`,
      [input.id_tipo_documento],
    );
    if (!tipoDoc) invalido("El tipo de documento seleccionado no existe.");
    if (tipoDoc.es_documento_externo !== 1) {
      invalido("El tipo de documento seleccionado no es un documento externo.");
    }

    if (input.lineas.length < 1) {
      invalido("Agrega al menos un repuesto o servicio a la cotización.");
    }

    for (const l of input.lineas) {
      if (l.tipo_item !== "Repuesto" && l.tipo_item !== "Servicio") {
        invalido("Hay una línea con un tipo de ítem inválido.");
      }
      if (!Number.isInteger(l.id_item)) {
        invalido("Hay una línea con un ítem inválido.");
      }
      if (!Number.isInteger(l.cantidad) || l.cantidad < 1) {
        invalido("La cantidad debe ser un número entero mayor o igual a 1.");
      }
      if (!Number.isFinite(l.precio_unitario) || l.precio_unitario <= 0) {
        invalido("El precio unitario debe ser mayor a 0.");
      }
    }

    // Unifica líneas repetidas (mismo tipo_item + id_item): suma cantidades.
    const unificadas = new Map<string, LineaCotizacionInput>();
    for (const l of input.lineas) {
      const clave = `${l.tipo_item}:${l.id_item}`;
      const previa = unificadas.get(clave);
      if (previa) {
        previa.cantidad += l.cantidad;
      } else {
        unificadas.set(clave, { ...l });
      }
    }
    const lineas = Array.from(unificadas.values());

    for (const l of lineas) {
      if (l.tipo_item === "Repuesto") {
        const r = await db.getFirstAsync<{
          nombre: string;
          stock_actual: number;
          estado_operativo: string;
        }>(
          `SELECT nombre, stock_actual, estado_operativo FROM Repuesto WHERE id_repuesto = ?;`,
          [l.id_item],
        );
        if (!r) invalido("Uno de los repuestos seleccionados ya no existe.");
        if (r.estado_operativo !== "Activo") {
          invalido(`El repuesto "${r.nombre}" está descontinuado.`);
        }
        if (l.cantidad > r.stock_actual) {
          throw new CotizacionError(
            "STOCK_INSUFICIENTE",
            `Stock insuficiente de "${r.nombre}": disponible ${r.stock_actual}, solicitado ${l.cantidad}.`,
          );
        }
      } else {
        const s = await db.getFirstAsync<{ id_servicio: number }>(
          `SELECT id_servicio FROM CatalogoServicio WHERE id_servicio = ?;`,
          [l.id_item],
        );
        if (!s) invalido("Uno de los servicios seleccionados ya no existe.");
      }
    }

    if (input.fotos.length > MAX_FOTOS) {
      invalido(`Solo se permiten hasta ${MAX_FOTOS} fotos por cotización.`);
    }
    for (const url of input.fotos) {
      if (!esUrlImagenValida(url)) {
        invalido(`La URL de foto no es válida: ${url}`);
      }
    }

    // --- b. Cabecera (monto_total inicial 0; lo recalcula el trigger) ---
    const fecha = fechaHoyLocal();
    const cab = await db.runAsync(
      `INSERT INTO Cotizacion (id_activo, id_tipo_documento, fecha_emision, monto_total, estado)
       VALUES (?, ?, ?, 0, 'Pendiente');`,
      [input.id_activo, input.id_tipo_documento, fecha],
    );
    nuevoId = cab.lastInsertRowId;

    // --- c. Líneas (precio_unitario = copia congelada) ---
    for (const l of lineas) {
      if (l.tipo_item === "Repuesto") {
        await db.runAsync(
          `INSERT INTO DetalleCotizacion
             (id_cotizacion, id_repuesto, id_servicio, tipo_item, cantidad, precio_unitario)
           VALUES (?, ?, NULL, 'Repuesto', ?, ?);`,
          [nuevoId, l.id_item, l.cantidad, l.precio_unitario],
        );
      } else {
        await db.runAsync(
          `INSERT INTO DetalleCotizacion
             (id_cotizacion, id_repuesto, id_servicio, tipo_item, cantidad, precio_unitario)
           VALUES (?, NULL, ?, 'Servicio', ?, ?);`,
          [nuevoId, l.id_item, l.cantidad, l.precio_unitario],
        );
      }
    }

    // --- d. Fotos ---
    for (const url of input.fotos) {
      await db.runAsync(
        `INSERT INTO FotoCotizacion (id_cotizacion, url_imagen, fecha_subida)
         VALUES (?, ?, ?);`,
        [nuevoId, url, fecha],
      );
    }
  });

  return nuevoId;
}
