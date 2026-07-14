/**
 * Contexto del contacto para la IA — nombre y trato por género.
 *
 * El nombre del cliente llega en el webhook de Callbell (`payload.contact.name`)
 * y se guarda en `contacts.name`. Antes de generar la respuesta se **antepone**
 * un bloque de contexto con su nombre al texto del turno que ve la IA (mismo
 * patrón que el marcador de Hotmart), NO al mensaje que se guarda en `messages`:
 * así el agente puede saludar/tratar al cliente por su nombre y adecuar el género
 * gramatical, pero el hilo del panel y la extracción de la orden quedan limpios.
 *
 * El género se **infiere del nombre** (los nombres de pila en español están
 * fuertemente marcados) — sin columna nueva, sin librería, sin llamada extra:
 * una sola llamada a Responses por turno. Ante un nombre ambiguo/unisex, el
 * bloque le pide a la IA usar lenguaje neutro. Puro y sin IO. Ver ADR-0047.
 */

/**
 * Extrae el primer nombre "usable" del nombre de contacto de Callbell.
 *
 * Toma la primera secuencia de letras (acentos, apóstrofos y guiones incluidos)
 * y la capitaliza. Devuelve null si no hay al menos dos letras seguidas — así se
 * descartan nombres que son puro teléfono/símbolos/emoji o una sola inicial.
 *
 * Ej: "María José" → "María" · "🌸mafe🌸" → "Mafe" · "573001234567" → null.
 */
export function firstName(fullName: string | null | undefined): string | null {
  if (!fullName) return null;
  const match = fullName.match(/\p{L}[\p{L}'’-]+/u);
  if (!match) return null;
  const word = match[0];
  return word.charAt(0).toLocaleUpperCase("es") + word.slice(1);
}

/**
 * Bloque de contexto que se antepone al texto del turno. Cadena vacía si no hay
 * un nombre usable (el turno queda intacto). Es contexto interno: se le pide a la
 * IA no mencionarlo.
 */
export function buildContactContext(name: string | null | undefined): string {
  const fn = firstName(name);
  if (!fn) return "";
  return (
    `[Contexto interno (no lo menciones ni digas que lo recibiste): el cliente se ` +
    `llama ${fn}. Cuando sea natural, dirígete a él/ella por su nombre; no lo ` +
    `repitas en cada mensaje. Deduce su género por el nombre y usa el género ` +
    `gramatical correcto (p. ej. "bienvenida"/"bienvenido", "estás segura"/"estás ` +
    `seguro"). Si el nombre es ambiguo o unisex, usa lenguaje neutro.]`
  );
}

/**
 * Antepone el bloque de contexto del contacto al texto del turno del cliente.
 *
 * - Si no hay nombre usable, devuelve el texto tal cual.
 * - Si el texto viene vacío (turno de solo imagen), devuelve solo el contexto.
 */
export function prependContactContext(
  text: string,
  name: string | null | undefined,
): string {
  const ctx = buildContactContext(name);
  if (!ctx) return text;
  if (text.trim().length === 0) return ctx;
  return `${ctx}\n\n${text}`;
}
