/**
 * Conversión de monedas para el dashboard (COP · USD · MXN). Ver ADR-0068.
 *
 * Tasas FIJAS en código, a propósito: la lectura tiene que ser estable y
 * reproducible (dos personas mirando el mismo filtro ven el mismo número, hoy y
 * mañana) y no queremos depender de un proveedor de FX en v1. Cuando el negocio
 * pida tasas reales, esto se muda a una tabla `fx_rates` con fecha y el resto del
 * código no se entera: solo cambia de dónde sale `USD_RATES`.
 */

/** Monedas con tasa conocida. Fuera de esta lista no se convierte (ver `convertMoney`). */
export const SUPPORTED_CURRENCIES = ["COP", "USD", "MXN"] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

/**
 * Unidades de cada moneda por 1 USD. El USD es el pivote: MXN↔COP sale de acá
 * (1 MXN = 3500/20 = 175 COP) en vez de guardar una tercera tasa que se pueda
 * contradecir con las otras dos.
 */
export const USD_RATES: Record<CurrencyCode, number> = {
  USD: 1,
  COP: 3500,
  MXN: 20,
};

/** Moneda por defecto cuando el dato no dice nada (mercado original: Colombia). */
export const DEFAULT_CURRENCY: CurrencyCode = "COP";

export function isSupportedCurrency(code: unknown): code is CurrencyCode {
  return (
    typeof code === "string" &&
    (SUPPORTED_CURRENCIES as readonly string[]).includes(code.trim().toUpperCase())
  );
}

/**
 * Texto suelto (`" usd "`, `null`, `"eur"`) → moneda soportada. Lo que no tiene
 * tasa cae al `fallback`: es para etiquetas y selectores, NO para decidir si un
 * monto se puede sumar — para eso está `convertMoney`, que devuelve `null`.
 */
export function normalizeCurrency(
  code: string | null | undefined,
  fallback: CurrencyCode = DEFAULT_CURRENCY,
): CurrencyCode {
  if (!isSupportedCurrency(code)) return fallback;
  return code.trim().toUpperCase() as CurrencyCode;
}

/**
 * Convierte un monto entre monedas soportadas. Devuelve `null` si alguna de las
 * dos no tiene tasa: quien llama decide qué hacer (excluir la fila y DECIRLO),
 * porque sumar un monto sin tasa como si fuera de la moneda destino inventa
 * plata que no existe.
 */
export function convertMoney(
  amount: number | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined,
): number | null {
  // `Number(null)` es 0: sin este guardia, un total vacío se sumaría como cero
  // convertido en vez de reportarse como "sin dato".
  if (amount === null || amount === undefined) return null;
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  if (!isSupportedCurrency(from) || !isSupportedCurrency(to)) return null;

  const src = normalizeCurrency(from);
  const dst = normalizeCurrency(to);
  if (src === dst) return value;

  // Pasa por USD siempre: una sola definición de las tasas, sin casos especiales.
  return (value / USD_RATES[src]) * USD_RATES[dst];
}

/**
 * Redondeo de presentación: las monedas sin centavos (COP) se muestran enteras y
 * las demás a 2 decimales. Se aplica al TOTAL ya sumado, no a cada fila, para no
 * arrastrar el error de redondeo N veces.
 */
export function roundForCurrency(amount: number, currency: CurrencyCode): number {
  if (!Number.isFinite(amount)) return 0;
  return currency === "COP" ? Math.round(amount) : Math.round(amount * 100) / 100;
}

export interface ConvertedSum {
  /** Suma en la moneda destino, ya redondeada. */
  total: number;
  /** Cuántos montos entraron a la suma (base del promedio). */
  counted: number;
  /** true si al menos un monto venía en otra moneda (el total es una equivalencia). */
  converted: boolean;
  /** Montos que NO se pudieron convertir y quedaron fuera. Hay que decirlo en pantalla. */
  excluded: number;
}

/**
 * Suma montos de monedas distintas homologándolos a `target`.
 *
 * Convierte ANTES de sumar y redondea UNA vez al final, no fila por fila: redondear
 * en cada fila arrastra el error N veces y el total deja de cuadrar con la lista.
 * Lo que no tiene tasa se excluye y se cuenta — sumarlo como si ya estuviera en la
 * moneda destino inventaría plata. Los montos nulos no son un error: son órdenes
 * sin total, no cuentan ni como suma ni como exclusión.
 */
export function sumConverted(
  entries: Array<{ amount: number | null | undefined; currency: string | null | undefined }>,
  target: CurrencyCode,
): ConvertedSum {
  let total = 0;
  let counted = 0;
  let converted = false;
  let excluded = 0;

  for (const e of entries) {
    if (e.amount === null || e.amount === undefined) continue;
    const value = convertMoney(e.amount, e.currency, target);
    if (value === null) {
      excluded += 1;
      continue;
    }
    if (normalizeCurrency(e.currency, target) !== target) converted = true;
    total += value;
    counted += 1;
  }

  return { total: roundForCurrency(total, target), counted, converted, excluded };
}

/** Etiqueta corta para selectores: `COP · Peso colombiano`. */
export const CURRENCY_LABELS: Record<CurrencyCode, string> = {
  COP: "Peso colombiano",
  USD: "Dólar",
  MXN: "Peso mexicano",
};

/**
 * Texto de la tasa usada, para mostrarlo junto a un total homologado. Que el
 * número convertido venga siempre con la tasa a la vista es parte del trato: sin
 * eso, un total en USD parece un dato del banco y no una equivalencia nuestra.
 */
export function rateNote(target: CurrencyCode): string {
  const others = SUPPORTED_CURRENCIES.filter((c) => c !== target);
  const parts = others.map((c) => {
    const perUnit = USD_RATES[target] / USD_RATES[c];
    // Se enuncia siempre desde la moneda "grande" para no leer "1 COP = 0,0002 USD".
    return perUnit >= 1
      ? `1 ${c} = ${trim(perUnit)} ${target}`
      : `1 ${target} = ${trim(1 / perUnit)} ${c}`;
  });
  return parts.join(" · ");
}

function trim(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(rounded);
}
