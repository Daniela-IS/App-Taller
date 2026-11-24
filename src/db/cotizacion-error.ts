export type CotizacionErrorCodigo =
  | "DATOS_INVALIDOS"
  | "STOCK_INSUFICIENTE"
  | "ESTADO_INVALIDO"
  | "NO_ENCONTRADA";

export class CotizacionError extends Error {
  readonly codigo: CotizacionErrorCodigo;

  constructor(codigo: CotizacionErrorCodigo, mensaje: string) {
    super(mensaje);
    this.name = "CotizacionError";
    this.codigo = codigo;
  }
}
