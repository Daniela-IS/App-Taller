// =====================================================================
// TALLER "ALEXANDER" — CONSULTAS DE LA PANTALLA HOME
//
// Solo lectura. La regla "En revisión" es la misma para el resumen y
// para la lista de vehículos recientes:
//   - tiene una OrdenDeTrabajo Pendiente o En Proceso, o
//   - tiene una Cotizacion Pendiente.
// Los vehículos que no cumplen la regla se consideran "Listos".
// =====================================================================

import { getDb } from "./database";

export type EstadoVehiculoHome = "En revisión" | "Listo";

export interface ResumenHome {
  vehiculosActivos: number;
  cotizacionesPendientes: number;
  vehiculosListos: number;
}

export interface VehiculoRecienteHome {
  id_activo: number;
  placa: string | null;
  marca: string | null;
  tipo_unidad: string;
  estado: EstadoVehiculoHome;
}

/**
 * Condición compartida. Se evalúa siempre contra el alias `a` (Activo),
 * por eso el resumen y la lista no pueden desincronizarse.
 */
const SQL_EN_REVISION = `(
  EXISTS (
    SELECT 1
      FROM OrdenDeTrabajo o
     WHERE o.id_activo = a.id_activo
       AND o.estado IN ('Pendiente', 'En Proceso')
  )
  OR EXISTS (
    SELECT 1
      FROM Cotizacion c
     WHERE c.id_activo = a.id_activo
       AND c.estado = 'Pendiente'
  )
)`;

/**
 * Números reales de las tres tarjetas de Home.
 * `vehiculosListos` = vehículos − vehículos en revisión.
 */
export async function getResumenHome(): Promise<ResumenHome> {
  const db = getDb();
  const fila = await db.getFirstAsync<ResumenHome>(
    `
    SELECT
      (SELECT COUNT(*)
         FROM Activo
        WHERE tipo_activo = 'Vehiculo') AS vehiculosActivos,
      (SELECT COUNT(*)
         FROM Cotizacion
        WHERE estado = 'Pendiente') AS cotizacionesPendientes,
      (SELECT COUNT(*)
         FROM Activo a
        WHERE a.tipo_activo = 'Vehiculo'
          AND NOT ${SQL_EN_REVISION}) AS vehiculosListos;
    `,
  );

  return {
    vehiculosActivos: fila?.vehiculosActivos ?? 0,
    cotizacionesPendientes: fila?.cotizacionesPendientes ?? 0,
    vehiculosListos: fila?.vehiculosListos ?? 0,
  };
}

/**
 * Últimos vehículos (tipo_activo = 'Vehiculo'), del id más alto al más bajo.
 * No existe una columna de fecha de creación en Activo, por eso se ordena
 * por `id_activo DESC`.
 *
 * `limite` se normaliza para que nunca se pase un valor negativo, decimal
 * o inválido a SQLite.
 */
export async function getVehiculosRecientes(
  limite: number = 5,
): Promise<VehiculoRecienteHome[]> {
  const db = getDb();
  const limiteSeguro =
    Number.isFinite(limite) && limite > 0 ? Math.trunc(limite) : 0;

  return db.getAllAsync<VehiculoRecienteHome>(
    `
    SELECT
      a.id_activo,
      a.placa,
      m.nombre  AS marca,
      tu.nombre AS tipo_unidad,
      CASE
        WHEN ${SQL_EN_REVISION} THEN 'En revisión'
        ELSE 'Listo'
      END AS estado
    FROM Activo a
    JOIN TipoUnidad tu ON tu.id_tipo_unidad = a.id_tipo_unidad
    LEFT JOIN Marca m  ON m.id_marca = a.id_marca
    WHERE a.tipo_activo = 'Vehiculo'
    ORDER BY a.id_activo DESC
    LIMIT ?;
    `,
    [limiteSeguro],
  );
}
