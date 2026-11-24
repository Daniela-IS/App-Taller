// TEMPORAL FRENTE B: borrar este archivo tras verificar.
import { getDb } from "./database";

export async function debugUltimaCotizacion(): Promise<void> {
  try {
    const db = getDb();

    const cot = await db.getFirstAsync<{ id_cotizacion: number }>(
      `SELECT * FROM Cotizacion ORDER BY id_cotizacion DESC LIMIT 1;`,
    );
    if (!cot) {
      console.log("[debugUltimaCotizacion] No hay cotizaciones.");
      return;
    }
    console.log("[debugUltimaCotizacion] Cotizacion:", JSON.stringify(cot));

    const lineas = await db.getAllAsync(
      `SELECT * FROM DetalleCotizacion WHERE id_cotizacion = ? ORDER BY id_detalle;`,
      [cot.id_cotizacion],
    );
    console.log("[debugUltimaCotizacion] Líneas:", JSON.stringify(lineas));

    const stocks = await db.getAllAsync(
      `SELECT id_repuesto, nombre, stock_actual FROM Repuesto
        WHERE id_repuesto IN (
          SELECT id_repuesto FROM DetalleCotizacion
           WHERE id_cotizacion = ? AND id_repuesto IS NOT NULL
        );`,
      [cot.id_cotizacion],
    );
    console.log(
      "[debugUltimaCotizacion] Stock actual:",
      JSON.stringify(stocks),
    );

    const fotos = await db.getFirstAsync<{ total: number }>(
      `SELECT COUNT(*) AS total FROM FotoCotizacion WHERE id_cotizacion = ?;`,
      [cot.id_cotizacion],
    );
    console.log("[debugUltimaCotizacion] Fotos:", fotos?.total ?? 0);
  } catch (e) {
    console.warn("[debugUltimaCotizacion] Error:", e);
  }
}
