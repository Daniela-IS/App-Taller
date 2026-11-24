// =====================================================================
// TALLER "ALEXANDER" — INVENTARIO (repuestos, proveedores y precios)
// Archivo NUEVO: src/db/inventario.ts
//
// No modifica database.ts: solo usa getDb(). Todos los errores de negocio
// se lanzan como InventarioError (códigos: DATOS_INVALIDOS,
// CODIGO_DUPLICADO, TIENE_HISTORIAL, NO_ENCONTRADO).
// =====================================================================

import { getDb } from "./database";
import type { EstadoRepuesto, Proveedor, Repuesto } from "./types";

// ---------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------

export type InventarioErrorCodigo =
  | "DATOS_INVALIDOS"
  | "CODIGO_DUPLICADO"
  | "TIENE_HISTORIAL"
  | "NO_ENCONTRADO";

export class InventarioError extends Error {
  readonly codigo: InventarioErrorCodigo;

  constructor(codigo: InventarioErrorCodigo, mensaje: string) {
    super(mensaje);
    this.name = "InventarioError";
    this.codigo = codigo;
  }
}

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

export interface RepuestoInput {
  nombre: string;
  codigo_referencia: string | null;
  stock_actual: number;
  es_comercial: 0 | 1;
  estado_operativo: EstadoRepuesto;
  url_imagen: string | null;
}

/** Repuesto con la columna url_imagen (que no figura en types.ts). */
export interface RepuestoDetalle extends Repuesto {
  url_imagen: string | null;
}

export interface PrecioDeRepuesto {
  id_proveedor: number;
  nombre: string; // nombre_comercial, o razón social si no tiene
  precio_ofrecido: number;
}

// ---------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------

function invalido(mensaje: string): never {
  throw new InventarioError("DATOS_INVALIDOS", mensaje);
}

const MSG_CODIGO_DUPLICADO =
  "Ya existe un repuesto con ese código de referencia.";

/** Texto vacío o solo espacios -> null (el UNIQUE de código no admite ''). */
function aNullSiVacio(valor: string | null | undefined): string | null {
  const limpio = valor?.trim() ?? "";
  return limpio === "" ? null : limpio;
}

function validarStock(stock: number): number {
  if (!Number.isInteger(stock) || stock < 0) {
    invalido("El stock debe ser un número entero mayor o igual a 0.");
  }
  return stock;
}

function validarRepuesto(i: RepuestoInput): RepuestoInput {
  const nombre = i.nombre?.trim() ?? "";
  if (nombre === "") invalido("El nombre del repuesto es obligatorio.");

  if (i.es_comercial !== 0 && i.es_comercial !== 1) {
    invalido("El tipo (Estándar/Especial) no es válido.");
  }
  if (i.estado_operativo !== "Activo" && i.estado_operativo !== "Descontinuado") {
    invalido("El estado debe ser Activo o Descontinuado.");
  }

  return {
    nombre,
    codigo_referencia: aNullSiVacio(i.codigo_referencia),
    stock_actual: validarStock(i.stock_actual),
    es_comercial: i.es_comercial,
    estado_operativo: i.estado_operativo,
    url_imagen: aNullSiVacio(i.url_imagen),
  };
}

function validarPrecio(precio: number): number {
  if (typeof precio !== "number" || !Number.isFinite(precio) || precio <= 0) {
    invalido("El precio debe ser un número mayor a 0.");
  }
  return Math.round(precio * 100) / 100;
}

/**
 * Repuesto.url_imagen no está en el esquema base (SCHEMA_SQL). Se agrega
 * una sola vez, de forma idempotente, para que funcione tanto en bases
 * nuevas como en las ya existentes.
 */
let columnaImagenLista = false;
async function asegurarColumnaImagen(): Promise<void> {
  if (columnaImagenLista) return;
  const db = getDb();
  const columnas = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(Repuesto);`,
  );
  if (!columnas.some((c) => c.name === "url_imagen")) {
    await db.execAsync(`ALTER TABLE Repuesto ADD COLUMN url_imagen TEXT;`);
  }
  columnaImagenLista = true;
}

async function existeRepuesto(id: number): Promise<boolean> {
  const fila = await getDb().getFirstAsync<{ id_repuesto: number }>(
    `SELECT id_repuesto FROM Repuesto WHERE id_repuesto = ?;`,
    [id],
  );
  return fila != null;
}

async function verificarCodigoLibre(
  codigo: string | null,
  excluirId: number,
): Promise<void> {
  if (codigo === null) return; // varios repuestos pueden tener código NULL
  const dup = await getDb().getFirstAsync<{ id_repuesto: number }>(
    `SELECT id_repuesto FROM Repuesto WHERE codigo_referencia = ? AND id_repuesto <> ?;`,
    [codigo, excluirId],
  );
  if (dup) throw new InventarioError("CODIGO_DUPLICADO", MSG_CODIGO_DUPLICADO);
}

/** Red de seguridad por si dos altas chocan a la vez en el UNIQUE. */
function traducirErrorSqlite(e: unknown): never {
  if (e instanceof InventarioError) throw e;
  const mensaje = e instanceof Error ? e.message : String(e);
  if (mensaje.includes("UNIQUE") && mensaje.includes("codigo_referencia")) {
    throw new InventarioError("CODIGO_DUPLICADO", MSG_CODIGO_DUPLICADO);
  }
  throw e;
}

// ---------------------------------------------------------------------
// REPUESTOS
// ---------------------------------------------------------------------

export async function crearRepuesto(i: RepuestoInput): Promise<number> {
  const v = validarRepuesto(i);
  await asegurarColumnaImagen();
  const db = getDb();

  try {
    await verificarCodigoLibre(v.codigo_referencia, -1);
    const res = await db.runAsync(
      `INSERT INTO Repuesto
         (nombre, codigo_referencia, stock_actual, es_comercial, estado_operativo, url_imagen)
       VALUES (?, ?, ?, ?, ?, ?);`,
      [
        v.nombre,
        v.codigo_referencia,
        v.stock_actual,
        v.es_comercial,
        v.estado_operativo,
        v.url_imagen,
      ],
    );
    return res.lastInsertRowId;
  } catch (e) {
    traducirErrorSqlite(e);
  }
}

export async function actualizarRepuesto(
  id: number,
  i: RepuestoInput,
): Promise<void> {
  const v = validarRepuesto(i);
  await asegurarColumnaImagen();
  const db = getDb();

  try {
    if (!(await existeRepuesto(id))) {
      throw new InventarioError("NO_ENCONTRADO", "El repuesto no existe.");
    }
    await verificarCodigoLibre(v.codigo_referencia, id);
    await db.runAsync(
      `UPDATE Repuesto
          SET nombre = ?, codigo_referencia = ?, stock_actual = ?,
              es_comercial = ?, estado_operativo = ?, url_imagen = ?
        WHERE id_repuesto = ?;`,
      [
        v.nombre,
        v.codigo_referencia,
        v.stock_actual,
        v.es_comercial,
        v.estado_operativo,
        v.url_imagen,
        id,
      ],
    );
  } catch (e) {
    traducirErrorSqlite(e);
  }
}

export async function ajustarStock(
  id: number,
  nuevoStock: number,
): Promise<void> {
  const stock = validarStock(nuevoStock);
  const res = await getDb().runAsync(
    `UPDATE Repuesto SET stock_actual = ? WHERE id_repuesto = ?;`,
    [stock, id],
  );
  if (res.changes === 0) {
    throw new InventarioError("NO_ENCONTRADO", "El repuesto no existe.");
  }
}

/**
 * Elimina un repuesto. Si aparece en alguna DetalleCotizacion lanza
 * TIENE_HISTORIAL (debe marcarse como Descontinuado). Si no, borra sus
 * filas de RepuestoProveedor y luego el repuesto, en una transacción.
 */
export async function eliminarRepuesto(id: number): Promise<void> {
  const db = getDb();

  await db.withTransactionAsync(async () => {
    if (!(await existeRepuesto(id))) {
      throw new InventarioError("NO_ENCONTRADO", "El repuesto no existe.");
    }

    const refs = await db.getFirstAsync<{ total: number }>(
      `SELECT COUNT(*) AS total FROM DetalleCotizacion WHERE id_repuesto = ?;`,
      [id],
    );
    if (refs && refs.total > 0) {
      throw new InventarioError(
        "TIENE_HISTORIAL",
        "Tiene cotizaciones asociadas; márcalo como Descontinuado",
      );
    }

    await db.runAsync(`DELETE FROM RepuestoProveedor WHERE id_repuesto = ?;`, [
      id,
    ]);
    await db.runAsync(`DELETE FROM Repuesto WHERE id_repuesto = ?;`, [id]);
  });
}

export async function getRepuestoPorId(
  id: number,
): Promise<RepuestoDetalle | null> {
  await asegurarColumnaImagen();
  const fila = await getDb().getFirstAsync<RepuestoDetalle>(
    `SELECT id_repuesto, nombre, codigo_referencia, stock_actual,
            es_comercial, estado_operativo, url_imagen
       FROM Repuesto WHERE id_repuesto = ?;`,
    [id],
  );
  return fila ?? null;
}

// ---------------------------------------------------------------------
// LISTADO PARA LA PANTALLA DE INVENTARIO
// ---------------------------------------------------------------------

/** Stock igual o menor a este valor se muestra en rojo en la lista. */
export const STOCK_BAJO = 5;

export interface RepuestoConPrecio extends RepuestoDetalle {
  mejor_precio: number | null;
  mejor_proveedor: string | null;
}

/**
 * Todos los repuestos con su mejor (menor) precio y el proveedor que lo
 * ofrece. Sin precios -> mejor_precio y mejor_proveedor quedan en null.
 */
export async function getRepuestosConPrecio(): Promise<RepuestoConPrecio[]> {
  await asegurarColumnaImagen();
  return getDb().getAllAsync<RepuestoConPrecio>(
    `SELECT r.id_repuesto, r.nombre, r.codigo_referencia, r.stock_actual,
            r.es_comercial, r.estado_operativo, r.url_imagen,
            (SELECT MIN(rp.precio_ofrecido)
               FROM RepuestoProveedor rp
              WHERE rp.id_repuesto = r.id_repuesto) AS mejor_precio,
            (SELECT COALESCE(p.nombre_comercial, p.razon_social)
               FROM RepuestoProveedor rp
               JOIN Proveedor p ON p.id_proveedor = rp.id_proveedor
              WHERE rp.id_repuesto = r.id_repuesto
              ORDER BY rp.precio_ofrecido ASC, p.id_proveedor ASC
              LIMIT 1) AS mejor_proveedor
       FROM Repuesto r
      ORDER BY r.nombre COLLATE NOCASE ASC;`,
  );
}

/** URL http/https sin espacios. Vacía se considera "sin imagen" (no pasa por aquí). */
export function esUrlImagenValida(url: string): boolean {
  return /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(url.trim());
}

// ---------------------------------------------------------------------
// PROVEEDORES
// ---------------------------------------------------------------------

export async function getProveedores(): Promise<Proveedor[]> {
  return getDb().getAllAsync<Proveedor>(
    `SELECT * FROM Proveedor
      ORDER BY COALESCE(nombre_comercial, razon_social) COLLATE NOCASE ASC;`,
  );
}

export async function crearProveedor(
  ruc: string,
  razon_social: string,
  nombre_comercial: string | null,
  contacto: string | null,
  ubicacion: string | null,
): Promise<number> {
  const rucLimpio = ruc?.trim() ?? "";
  if (!/^\d{11}$/.test(rucLimpio)) invalido("El RUC debe tener 11 dígitos.");
  const razon = razon_social?.trim() ?? "";
  if (razon === "") invalido("La razón social es obligatoria.");

  const db = getDb();
  const dup = await db.getFirstAsync<{ id_proveedor: number }>(
    `SELECT id_proveedor FROM Proveedor WHERE ruc = ?;`,
    [rucLimpio],
  );
  if (dup) invalido("Ya existe un proveedor con ese RUC.");

  const res = await db.runAsync(
    `INSERT INTO Proveedor (ruc, razon_social, nombre_comercial, contacto, ubicacion)
     VALUES (?, ?, ?, ?, ?);`,
    [
      rucLimpio,
      razon,
      aNullSiVacio(nombre_comercial),
      aNullSiVacio(contacto),
      aNullSiVacio(ubicacion),
    ],
  );
  return res.lastInsertRowId;
}

// ---------------------------------------------------------------------
// PRECIOS POR PROVEEDOR (RepuestoProveedor)
// ---------------------------------------------------------------------

/** Precios de un repuesto, del más barato al más caro. */
export async function getPreciosDeRepuesto(
  id: number,
): Promise<PrecioDeRepuesto[]> {
  return getDb().getAllAsync<PrecioDeRepuesto>(
    `SELECT rp.id_proveedor,
            COALESCE(p.nombre_comercial, p.razon_social) AS nombre,
            rp.precio_ofrecido
       FROM RepuestoProveedor rp
       JOIN Proveedor p ON p.id_proveedor = rp.id_proveedor
      WHERE rp.id_repuesto = ?
      ORDER BY rp.precio_ofrecido ASC, nombre COLLATE NOCASE ASC;`,
    [id],
  );
}

/** Inserta el precio, o lo actualiza si la pareja (repuesto, proveedor) ya existe. */
export async function guardarPrecioProveedor(
  idRepuesto: number,
  idProveedor: number,
  precio: number,
): Promise<void> {
  const precioOk = validarPrecio(precio);
  const db = getDb();

  if (!(await existeRepuesto(idRepuesto))) {
    throw new InventarioError("NO_ENCONTRADO", "El repuesto no existe.");
  }
  const prov = await db.getFirstAsync<{ id_proveedor: number }>(
    `SELECT id_proveedor FROM Proveedor WHERE id_proveedor = ?;`,
    [idProveedor],
  );
  if (!prov) {
    throw new InventarioError("NO_ENCONTRADO", "El proveedor no existe.");
  }

  await db.runAsync(
    `INSERT INTO RepuestoProveedor (id_repuesto, id_proveedor, precio_ofrecido)
     VALUES (?, ?, ?)
     ON CONFLICT(id_repuesto, id_proveedor)
     DO UPDATE SET precio_ofrecido = excluded.precio_ofrecido;`,
    [idRepuesto, idProveedor, precioOk],
  );
}

export async function quitarPrecioProveedor(
  idRepuesto: number,
  idProveedor: number,
): Promise<void> {
  await getDb().runAsync(
    `DELETE FROM RepuestoProveedor WHERE id_repuesto = ? AND id_proveedor = ?;`,
    [idRepuesto, idProveedor],
  );
}
