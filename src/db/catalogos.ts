// Lecturas compartidas de solo lectura (catálogos de cotización e inventario).

import { getDb } from "./database";
import type { EstadoRepuesto, SQLiteBoolean } from "./types";

export const STOCK_BAJO = 5;

export interface RepuestoConPrecio {
  id_repuesto: number;
  nombre: string;
  codigo_referencia: string | null;
  stock_actual: number;
  es_comercial: SQLiteBoolean;
  estado_operativo: EstadoRepuesto;
  url_imagen: string | null;
  mejor_precio: number | null;
  mejor_proveedor: string | null;
}

export interface ServicioCatalogo {
  id_servicio: number;
  nombre: string;
  descripcion: string | null;
  precio_referencial: number;
}

export interface TipoDocumentoExterno {
  id_tipo_documento: number;
  nombre: string;
}

/** Todos los repuestos (cualquier estado) con su mejor precio de proveedor, por nombre. */
export async function getRepuestosConPrecio(): Promise<RepuestoConPrecio[]> {
  const db = getDb();
  return db.getAllAsync<RepuestoConPrecio>(
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

export async function getServicios(): Promise<ServicioCatalogo[]> {
  const db = getDb();
  return db.getAllAsync<ServicioCatalogo>(
    `SELECT id_servicio, nombre, descripcion, precio_referencial
       FROM CatalogoServicio
      ORDER BY nombre COLLATE NOCASE ASC;`,
  );
}

export async function getTiposDocumentoExternos(): Promise<
  TipoDocumentoExterno[]
> {
  const db = getDb();
  return db.getAllAsync<TipoDocumentoExterno>(
    `SELECT id_tipo_documento, nombre
       FROM TipoDocumento
      WHERE es_documento_externo = 1
      ORDER BY id_tipo_documento ASC;`,
  );
}
