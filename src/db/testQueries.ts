// =====================================================================
// TALLER "ALEXANDER" — RUNNER DE PRUEBAS DE LÓGICA (sin UI)
//
// Uso:
//   import { runAllTests } from "../db/testQueries";
//   await runAllTests();
//
// No inserta datos propios: parte de resetDatabase() + initDatabase() y
// valida el seed de Fase 0. Cada prueba imprime ✔ o ✘ en la consola.
// =====================================================================

import { CotizacionError } from "./cotizacion-error";
import {
  ActivoError,
  eliminarVehiculo,
  getDb,
  initDatabase,
  resetDatabase,
} from "./database";
import { getResumenHome, getVehiculosRecientes } from "./home";
import { sembrarDatosIniciales, sembrarDatosOperativos } from "./seed";
import type { EstadoCotizacion } from "./types";

// ---------------------------------------------------------------------
// Infraestructura mínima de pruebas
// ---------------------------------------------------------------------

interface ResumenPruebas {
  total: number;
  correctas: number;
  fallidas: number;
  omitidas: number;
}

export interface ResultadoPruebas extends ResumenPruebas {
  ok: boolean;
}

let resumen: ResumenPruebas = {
  total: 0,
  correctas: 0,
  fallidas: 0,
  omitidas: 0,
};

function asegurar(condicion: boolean, mensaje: string): asserts condicion {
  if (!condicion) throw new Error(mensaje);
}

async function probar(
  nombre: string,
  fn: () => Promise<void> | void,
): Promise<void> {
  resumen.total += 1;
  try {
    await fn();
    resumen.correctas += 1;
    console.log(`✔ ${nombre}`);
  } catch (error) {
    resumen.fallidas += 1;
    const detalle = error instanceof Error ? error.message : String(error);
    console.error(`✘ ${nombre} — ${detalle}`);
  }
}

function omitir(nombre: string, motivo: string): void {
  resumen.total += 1;
  resumen.omitidas += 1;
  console.log(`⏭ ${nombre} — ${motivo}`);
}

async function contarTabla(tabla: string): Promise<number> {
  const fila = await getDb().getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total FROM ${tabla};`,
  );
  return fila?.total ?? 0;
}

async function conteosActuales(): Promise<Record<string, number>> {
  const resultado: Record<string, number> = {};
  for (const [tabla] of TABLAS_ESPERADAS) {
    resultado[tabla] = await contarTabla(tabla);
  }
  return resultado;
}

async function mapaStockRepuestos(): Promise<Map<number, number>> {
  const filas = await getDb().getAllAsync<{
    id_repuesto: number;
    stock_actual: number;
  }>(`SELECT id_repuesto, stock_actual FROM Repuesto;`);

  return new Map(filas.map((f) => [f.id_repuesto, f.stock_actual]));
}

// ---------------------------------------------------------------------
// 1. Cuentas esperadas del seed
// ---------------------------------------------------------------------

const TABLAS_ESPERADAS: readonly (readonly [string, number])[] = [
  ["Repuesto", 10],
  ["Proveedor", 3],
  ["Cotizacion", 4],
  ["DetalleCotizacion", 8],
  ["FotoCotizacion", 2],
  ["RepuestoProveedor", 12],
  ["Cliente", 7],
  ["Activo", 11],
  ["Medidor", 11],
  ["OrdenDeTrabajo", 3],
  ["CatalogoServicio", 6],
  ["TipoDocumento", 3],
  ["TipoMantenimiento", 6],
  ["Trabajador", 2],
  ["Rol", 2],
  ["Marca", 6],
  ["TipoUnidad", 4],
];

async function probarConteosSeed(): Promise<void> {
  for (const [tabla, esperado] of TABLAS_ESPERADAS) {
    await probar(`Cuenta de ${tabla} = ${esperado}`, async () => {
      const real = await contarTabla(tabla);
      asegurar(real === esperado, `se encontraron ${real} filas`);
    });
  }
}

// ---------------------------------------------------------------------
// 2. El trigger mantiene monto_total = suma de las líneas
// ---------------------------------------------------------------------

async function probarMontosCotizaciones(): Promise<void> {
  await probar(
    "Cada cotización tiene monto_total = suma de sus líneas",
    async () => {
      const filas = await getDb().getAllAsync<{
        id_cotizacion: number;
        monto_total: number;
        suma_lineas: number;
      }>(
        `
        SELECT c.id_cotizacion,
               c.monto_total,
               COALESCE((
                 SELECT SUM(dc.cantidad * dc.precio_unitario)
                   FROM DetalleCotizacion dc
                  WHERE dc.id_cotizacion = c.id_cotizacion
               ), 0) AS suma_lineas
          FROM Cotizacion c
         ORDER BY c.id_cotizacion ASC;
        `,
      );

      asegurar(filas.length > 0, "el seed no dejó cotizaciones");

      const inconsistentes = filas.filter(
        (f) => Math.abs(f.monto_total - f.suma_lineas) > 0.001,
      );
      asegurar(
        inconsistentes.length === 0,
        `montos distintos: ${inconsistentes
          .map(
            (f) =>
              `#${f.id_cotizacion} ${f.monto_total} ≠ ${f.suma_lineas}`,
          )
          .join(", ")}`,
      );
    },
  );
}

// ---------------------------------------------------------------------
// 3. Un segundo arranque no duplica filas (seeds idempotentes)
// ---------------------------------------------------------------------

async function probarArranqueIdempotente(): Promise<void> {
  await probar(
    "Un segundo arranque de los seeds no duplica filas",
    async () => {
      const antes = await conteosActuales();

      // initDatabase() ya está inicializada: devuelve la misma instancia.
      // Las funciones de seed sí se vuelven a ejecutar, igual que en un
      // reinicio real de la app sobre una base existente.
      await initDatabase();
      await sembrarDatosIniciales(getDb());
      await sembrarDatosOperativos(getDb());

      const despues = await conteosActuales();
      const diferencias = TABLAS_ESPERADAS.filter(
        ([tabla]) => antes[tabla] !== despues[tabla],
      ).map(
        ([tabla]) =>
          `${tabla}: ${antes[tabla]} → ${despues[tabla] ?? "sin dato"}`,
      );

      asegurar(
        diferencias.length === 0,
        `se duplicaron filas (${diferencias.join(", ")})`,
      );
    },
  );
}

// ---------------------------------------------------------------------
// 4. Home coincide con consultas manuales
// ---------------------------------------------------------------------

async function probarResumenHome(): Promise<void> {
  await probar(
    "getResumenHome() coincide con las consultas manuales",
    async () => {
      const manual = await getDb().getFirstAsync<{
        vehiculosActivos: number;
        cotizacionesPendientes: number;
        vehiculosListos: number;
      }>(
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
              AND NOT (
                EXISTS (
                  SELECT 1 FROM OrdenDeTrabajo o
                   WHERE o.id_activo = a.id_activo
                     AND o.estado IN ('Pendiente', 'En Proceso')
                )
                OR EXISTS (
                  SELECT 1 FROM Cotizacion c
                   WHERE c.id_activo = a.id_activo
                     AND c.estado = 'Pendiente'
                )
              )) AS vehiculosListos;
        `,
      );

      const real = await getResumenHome();
      asegurar(
        real.vehiculosActivos === (manual?.vehiculosActivos ?? -1),
        `vehiculosActivos: ${real.vehiculosActivos} ≠ ${manual?.vehiculosActivos}`,
      );
      asegurar(
        real.cotizacionesPendientes ===
          (manual?.cotizacionesPendientes ?? -1),
        `cotizacionesPendientes: ${real.cotizacionesPendientes} ≠ ${manual?.cotizacionesPendientes}`,
      );
      asegurar(
        real.vehiculosListos === (manual?.vehiculosListos ?? -1),
        `vehiculosListos: ${real.vehiculosListos} ≠ ${manual?.vehiculosListos}`,
      );
    },
  );

  await probar(
    "getVehiculosRecientes() respeta orden DESC, límite y estado",
    async () => {
      const limite = 5;
      const real = await getVehiculosRecientes(limite);
      const esperado = await getDb().getAllAsync<{
        id_activo: number;
        estado: string;
      }>(
        `
        SELECT a.id_activo,
               CASE
                 WHEN (
                   EXISTS (
                     SELECT 1 FROM OrdenDeTrabajo o
                      WHERE o.id_activo = a.id_activo
                        AND o.estado IN ('Pendiente', 'En Proceso')
                   )
                   OR EXISTS (
                     SELECT 1 FROM Cotizacion c
                      WHERE c.id_activo = a.id_activo
                        AND c.estado = 'Pendiente'
                   )
                 ) THEN 'En revisión'
                 ELSE 'Listo'
               END AS estado
          FROM Activo a
         WHERE a.tipo_activo = 'Vehiculo'
         ORDER BY a.id_activo DESC
         LIMIT ?;
        `,
        [limite],
      );

      asegurar(real.length <= limite, `devolvió ${real.length} filas`);
      asegurar(
        real.length === esperado.length,
        `devolvió ${real.length} filas, se esperaban ${esperado.length}`,
      );

      for (let i = 0; i < real.length; i += 1) {
        asegurar(
          real[i].id_activo === esperado[i].id_activo,
          `orden incorrecto en la posición ${i}`,
        );
        asegurar(
          real[i].estado === esperado[i].estado,
          `estado incorrecto para el activo ${real[i].id_activo}: ${real[i].estado}`,
        );
      }
    },
  );
}

// ---------------------------------------------------------------------
// 5. Aprobación con el frente C (opcional hasta que exista el módulo)
// ---------------------------------------------------------------------

type EstadoCambiable = Extract<
  EstadoCotizacion,
  "Aprobada" | "Rechazada" | "Anulada"
>;

type CambiarEstadoCotizacion = (
  idCotizacion: number,
  nuevoEstado: EstadoCambiable,
) => Promise<void>;

interface LineaPendiente {
  id_cotizacion: number;
  id_activo: number;
  id_repuesto: number;
  cantidad: number;
  stock_actual: number;
  nombre: string;
}

async function cargarCambiarEstadoCotizacion(): Promise<CambiarEstadoCotizacion | null> {
  try {
    // @ts-ignore — db/cotizaciones-estado.ts lo crea el frente C. Si esta
    // rama todavía no lo tiene, la prueba se omite en vez de romper el runner.
    // eslint-disable-next-line import/no-unresolved
    const modulo = (await import("./cotizaciones-estado")) as {
      cambiarEstadoCotizacion?: CambiarEstadoCotizacion;
    };
    return typeof modulo.cambiarEstadoCotizacion === "function"
      ? modulo.cambiarEstadoCotizacion
      : null;
  } catch {
    return null;
  }
}

async function lineasPendientesConRepuesto(): Promise<LineaPendiente[]> {
  return getDb().getAllAsync<LineaPendiente>(
    `
    SELECT c.id_cotizacion,
           c.id_activo,
           dc.id_repuesto,
           dc.cantidad,
           r.stock_actual,
           r.nombre
      FROM Cotizacion c
      JOIN DetalleCotizacion dc ON dc.id_cotizacion = c.id_cotizacion
      JOIN Repuesto r           ON r.id_repuesto = dc.id_repuesto
     WHERE c.estado = 'Pendiente'
       AND dc.tipo_item = 'Repuesto'
       AND dc.id_repuesto IS NOT NULL
     ORDER BY c.id_cotizacion ASC, dc.id_detalle ASC;
    `,
  );
}

function agruparPorCotizacion(
  lineas: LineaPendiente[],
): Map<number, LineaPendiente[]> {
  const grupos = new Map<number, LineaPendiente[]>();
  for (const linea of lineas) {
    const grupo = grupos.get(linea.id_cotizacion) ?? [];
    grupo.push(linea);
    grupos.set(linea.id_cotizacion, grupo);
  }
  return grupos;
}

function requeridoPorRepuesto(
  lineas: LineaPendiente[],
): Map<number, number> {
  const requerido = new Map<number, number>();
  for (const linea of lineas) {
    requerido.set(
      linea.id_repuesto,
      (requerido.get(linea.id_repuesto) ?? 0) + linea.cantidad,
    );
  }
  return requerido;
}

async function probarAprobacionConStock(
  cambiarEstado: CambiarEstadoCotizacion | null,
): Promise<void> {
  if (!cambiarEstado) {
    omitir(
      "Aprobar con stock suficiente y con stock insuficiente",
      "falta db/cotizaciones-estado.ts (frente C) en esta rama",
    );
    return;
  }

  await probar(
    "Aprobar con stock suficiente descuenta el stock y cambia el estado",
    async () => {
      const db = getDb();
      const grupos = agruparPorCotizacion(
        await lineasPendientesConRepuesto(),
      );

      let elegida: [number, LineaPendiente[]] | null = null;
      for (const [idCotizacion, lineas] of grupos) {
        const requerido = requeridoPorRepuesto(lineas);
        const alcanza = [...requerido.entries()].every(
          ([idRepuesto, cantidad]) => {
            const stock =
              lineas.find((l) => l.id_repuesto === idRepuesto)
                ?.stock_actual ?? 0;
            return stock >= cantidad;
          },
        );
        if (alcanza) {
          elegida = [idCotizacion, lineas];
          break;
        }
      }

      asegurar(
        elegida !== null,
        "no hay ninguna cotización Pendiente con stock suficiente",
      );

      const [idCotizacion, lineas] = elegida!;
      const idActivo = lineas[0].id_activo;
      const requerido = requeridoPorRepuesto(lineas);
      const stockAntes = new Map(
        lineas.map((l) => [l.id_repuesto, l.stock_actual]),
      );
      const resumenAntes = await getResumenHome();

      const otrasPendientes = await db.getFirstAsync<{ total: number }>(
        `SELECT COUNT(*) AS total
           FROM Cotizacion
          WHERE id_activo = ? AND estado = 'Pendiente' AND id_cotizacion <> ?;`,
        [idActivo, idCotizacion],
      );
      const ordenesAbiertas = await db.getFirstAsync<{ total: number }>(
        `SELECT COUNT(*) AS total
           FROM OrdenDeTrabajo
          WHERE id_activo = ? AND estado IN ('Pendiente', 'En Proceso');`,
        [idActivo],
      );

      await cambiarEstado(idCotizacion, "Aprobada");

      const cabecera = await db.getFirstAsync<{ estado: string }>(
        `SELECT estado FROM Cotizacion WHERE id_cotizacion = ?;`,
        [idCotizacion],
      );
      asegurar(
        cabecera?.estado === "Aprobada",
        `el estado quedó en ${cabecera?.estado}`,
      );

      const resumenDespues = await getResumenHome();
      asegurar(
        resumenDespues.cotizacionesPendientes ===
          resumenAntes.cotizacionesPendientes - 1,
        `cotizacionesPendientes: ${resumenAntes.cotizacionesPendientes} → ${resumenDespues.cotizacionesPendientes}`,
      );

      const quedaLibre =
        (otrasPendientes?.total ?? 0) === 0 &&
        (ordenesAbiertas?.total ?? 0) === 0;
      if (quedaLibre) {
        asegurar(
          resumenDespues.vehiculosListos === resumenAntes.vehiculosListos + 1,
          `vehiculosListos: ${resumenAntes.vehiculosListos} → ${resumenDespues.vehiculosListos}`,
        );
        const recientes = await getVehiculosRecientes(100);
        asegurar(
          recientes.find((v) => v.id_activo === idActivo)?.estado === "Listo",
          `el vehículo #${idActivo} no quedó como Listo`,
        );
      } else {
        asegurar(
          resumenDespues.vehiculosListos === resumenAntes.vehiculosListos,
          `vehiculosListos cambió aunque el vehículo seguía en revisión`,
        );
      }

      for (const [idRepuesto, cantidad] of requerido) {
        const repuesto = await db.getFirstAsync<{ stock_actual: number }>(
          `SELECT stock_actual FROM Repuesto WHERE id_repuesto = ?;`,
          [idRepuesto],
        );
        const esperado = (stockAntes.get(idRepuesto) ?? 0) - cantidad;
        asegurar(
          repuesto?.stock_actual === esperado,
          `repuesto #${idRepuesto}: stock ${repuesto?.stock_actual}, se esperaba ${esperado}`,
        );
      }
    },
  );

  await probar(
    "Aprobar con stock insuficiente falla sin cambios (rollback)",
    async () => {
      const db = getDb();
      const lineas = await lineasPendientesConRepuesto();
      asegurar(
        lineas.length > 0,
        "no queda otra cotización Pendiente con repuestos",
      );

      const objetivo = lineas[0];
      const stockOriginal = objetivo.stock_actual;
      const stockInsuficiente = Math.max(0, objetivo.cantidad - 1);

      try {
        await db.runAsync(
          `UPDATE Repuesto SET stock_actual = ? WHERE id_repuesto = ?;`,
          [stockInsuficiente, objetivo.id_repuesto],
        );

        const stocksAntes = await mapaStockRepuestos();
        const resumenAntesFallo = await getResumenHome();

        let capturado: unknown = null;
        try {
          await cambiarEstado(objetivo.id_cotizacion, "Aprobada");
        } catch (error) {
          capturado = error;
        }

        asegurar(
          capturado instanceof CotizacionError,
          "no lanzó CotizacionError",
        );
        asegurar(
          capturado.codigo === "STOCK_INSUFICIENTE",
          `código de error ${capturado.codigo}`,
        );

        const cabecera = await db.getFirstAsync<{ estado: string }>(
          `SELECT estado FROM Cotizacion WHERE id_cotizacion = ?;`,
          [objetivo.id_cotizacion],
        );
        asegurar(
          cabecera?.estado === "Pendiente",
          `el estado cambió a ${cabecera?.estado}`,
        );

        const stocksDespues = await mapaStockRepuestos();
        for (const [idRepuesto, stock] of stocksAntes) {
          asegurar(
            stocksDespues.get(idRepuesto) === stock,
            `el stock del repuesto #${idRepuesto} cambió (${stock} → ${stocksDespues.get(idRepuesto)})`,
          );
        }

        const resumenDespuesFallo = await getResumenHome();
        asegurar(
          resumenDespuesFallo.vehiculosActivos ===
            resumenAntesFallo.vehiculosActivos &&
            resumenDespuesFallo.cotizacionesPendientes ===
              resumenAntesFallo.cotizacionesPendientes &&
            resumenDespuesFallo.vehiculosListos ===
              resumenAntesFallo.vehiculosListos,
          "el resumen de Home cambió tras el fallo por stock",
        );
      } finally {
        // Restaura el seed para no contaminar las demás pruebas.
        await db.runAsync(
          `UPDATE Repuesto SET stock_actual = ? WHERE id_repuesto = ?;`,
          [stockOriginal, objetivo.id_repuesto],
        );
      }
    },
  );
}

// ---------------------------------------------------------------------
// 6. Eliminar un activo con cotizaciones debe quedar bloqueado
// ---------------------------------------------------------------------

async function probarEliminarActivoConCotizaciones(): Promise<void> {
  await probar(
    "eliminarVehiculo() lanza ActivoError en un activo con cotizaciones",
    async () => {
      const db = getDb();
      const fila = await db.getFirstAsync<{
        id_activo: number;
        total: number;
      }>(
        `
        SELECT a.id_activo, COUNT(c.id_cotizacion) AS total
          FROM Activo a
          JOIN Cotizacion c ON c.id_activo = a.id_activo
         GROUP BY a.id_activo
         ORDER BY total DESC, a.id_activo ASC
         LIMIT 1;
        `,
      );

      asegurar(
        fila !== null && fila.total > 0,
        "el seed no tiene activos con cotizaciones",
      );

      let capturado: unknown = null;
      try {
        await eliminarVehiculo(fila!.id_activo);
      } catch (error) {
        capturado = error;
      }

      asegurar(capturado instanceof ActivoError, "no lanzó ActivoError");
      asegurar(
        capturado.codigo === "TIENE_HISTORIAL",
        `código de error ${capturado.codigo}`,
      );

      const sigueExistiendo = await db.getFirstAsync<{ id_activo: number }>(
        `SELECT id_activo FROM Activo WHERE id_activo = ?;`,
        [fila!.id_activo],
      );
      asegurar(
        sigueExistiendo !== null,
        "el activo se eliminó a pesar de tener cotizaciones",
      );
    },
  );
}

// ---------------------------------------------------------------------
// Punto de entrada
// ---------------------------------------------------------------------

/**
 * Resetea la base, la vuelve a sembrar y ejecuta todas las aserciones.
 * Se puede llamar desde un botón temporal o desde la consola sin agregar
 * pantallas nuevas.
 */
export async function runAllTests(): Promise<ResultadoPruebas> {
  console.log(
    '=== INICIANDO PRUEBAS DE BASE DE DATOS — TALLER "ALEXANDER" ===',
  );

  resumen = { total: 0, correctas: 0, fallidas: 0, omitidas: 0 };

  try {
    await resetDatabase();
    await initDatabase();
  } catch (error) {
    console.error("✘ No se pudo preparar la base de datos:", error);
    resumen.total += 1;
    resumen.fallidas += 1;
    return { ...resumen, ok: false };
  }

  await probarConteosSeed();
  await probarMontosCotizaciones();
  await probarArranqueIdempotente();
  await probarResumenHome();

  const cambiarEstado = await cargarCambiarEstadoCotizacion();
  await probarAprobacionConStock(cambiarEstado);

  await probarEliminarActivoConCotizaciones();

  const ok = resumen.fallidas === 0;
  console.log(
    `\n${ok ? "✔" : "✘"} RESULTADO: ${resumen.correctas} correctas, ` +
      `${resumen.fallidas} fallidas, ${resumen.omitidas} omitidas ` +
      `(${resumen.total} pruebas).`,
  );

  return { ...resumen, ok };
}
