# ADR-0079: La moneda que manda es la de VENTA (la pauta se convierte), y la semana como unidad de lectura

- **Estado:** Aceptada
- **Fecha:** 2026-07-22
- **Sprint:** 6 (reportes)

## Contexto

Después de ADR-0077 (homologar antes de sumar) y ADR-0078 (decirlo en pantalla), el
dashboard **seguía mostrando dos verdades distintas en la misma pantalla**: las tarjetas
decían `$3.238.652` de órdenes generadas y, más abajo, el ROAS decía `$4.101.585` sobre los
mismos hechos. La segunda cifra era la correcta.

La causa es que un agente tiene **dos** columnas de moneda y cada sección leía una:

- `agents.currency` — la moneda en la que **vende** (0029, `not null default 'COP'`).
- `agents.cost_currency` — la moneda en la que se **paga la pauta** (0028).

En producción estaban así: *Vitasei Mexico* `venta=COP` / `pauta=MXN (9/chat)`, *Vitasei USA*
`venta=COP` / `pauta=USD (0,5/chat)`. Es decir, el dueño **sí** configuró sus mercados —pero
en el campo de la pauta, que en el editor estaba en otro bloque del formulario y cuya ayuda
decía "la de este mercado (COP, USD…)". La de venta se quedó en el default y nadie se enteró.

Y debajo había un bug peor, que existía desde antes y que ninguna de las dos cifras delataba:
`summarizeRoas` usaba `cost_currency` como moneda de **toda** la fila, ventas incluidas. O
sea que la fila de México dividía **inversión en pesos mexicanos entre ventas en pesos
colombianos** y llamaba a eso ROAS. Que el consolidado diera el número correcto fue
coincidencia: `cost_currency` resultaba ser la moneda real de venta de ese mercado.

Aparte, faltaba una unidad de lectura intermedia: el día a día de WhatsApp es ruido (un
festivo, la pauta que arrancó tarde) y el mes tarda demasiado en decir algo.

## Decisión

1. **Una sola moneda manda: la de VENTA.** Es la del mercado y la de `revenue`. Cada fila del
   ROAS se lee en ella y la **pauta se convierte** a esa moneda antes de calcular inversión,
   ROAS, CPA y ganancia. `AgentCostConfig` pasa a llevar las dos monedas explícitas
   (`saleCurrency` y `costCurrency`) en vez de un `currency` ambiguo que cada quien
   interpretaba a su manera.
2. **El desfase se pregunta, no se traga.** Si un agente vende en una moneda y paga la pauta
   en otra, Reportes lo dice con nombre propio ("Vitasei Mexico vende en MXN y pauta en USD")
   y ofrece el enlace a Agentes. Es legítimo —Meta cobra en dólares— pero es también la forma
   exacta que toma un mercado a medio configurar. No se marca cuando no hay costo por chat:
   ahí no hay pauta que contradiga nada.
3. **Las dos monedas viven en el MISMO bloque del editor**, junto al costo por chat, y la de
   la pauta **sigue** a la de venta mientras nadie la separe a mano. Ambas pasan a ser
   `<select>` de monedas con tasa conocida (la de la pauta era un `<input>` libre de 3
   letras). Es imposible configurar una sin ver la otra — que fue exactamente el fallo.
4. **Backfill explícito** (`0030`) con el mapeo que decidió el negocio: CO→COP, Mexico→MXN,
   USA→USD, Hotmart (MX)→USD. Va como migración versionada y no como un `UPDATE` a mano:
   queda auditable y repetible.
5. **La semana como unidad de lectura** (`summarizeWeekly`): chats de la semana partidos por
   agente, contra las ventas cerradas esa semana. Sale de los MISMOS hechos que el ROAS (sin
   queries nuevas), así que cuadra con el resto de la página.

## Consecuencias

- Los números de la página dejan de contradecirse: tarjetas, ROAS y semanal salen todos de
  la moneda de venta homologada a la de lectura.
- El ROAS por fila cambia donde venta ≠ pauta. En el caso de prueba, un agente que vende en
  MXN y paga 2 USD/chat pasa de un `100×` inventado a `5×` real. **Números de ROAS previos
  a este cambio, para mercados con las dos monedas distintas, eran falsos.**
- Sigue habiendo dos columnas. Se evaluó fusionarlas y se descartó: pagar la pauta en dólares
  facturando en moneda local es real en LatAm, y fusionar obligaría a migrar el día que se
  separen. El costo de mantenerlas es la ambigüedad, y esa se paga con UI (bloque único +
  aviso), no con esquema.
- El backfill nombra agentes por `name`. Es frágil ante un renombre, pero es idempotente y
  explícito; la alternativa (por id) no se puede escribir sin acoplar la migración a una base
  concreta.
- La semana en curso va incompleta y se marca como tal: comparar un martes contra una semana
  cerrada es la forma más fácil de leer una caída donde no la hay.

## Alternativas consideradas

- **Deducir la moneda de venta desde `cost_currency` cuando la primera está en el default**:
  imposible distinguir el default de una decisión (`not null default 'COP'`), y adivinar es
  cómo se llega a un dashboard que miente con confianza.
- **Hacer `agents.currency` nullable** para distinguir "sin configurar": correcto de fondo,
  queda anotado, pero obliga a decidir qué hace cada lector con un null. El bloque único del
  editor + el backfill resuelven el daño observable hoy.
- **Gráfico semanal con queries propias**: habría permitido más ventanas de tiempo, pero
  abre la puerta a que la semana no cuadre con el ROAS. Derivarlo de los mismos hechos
  garantiza que sí.
- **Mostrar la semana como líneas (chats y ventas superpuestas)**: más denso, pero pierde el
  desglose por agente, que es justamente lo que responde "¿cuál mercado está creciendo?".
