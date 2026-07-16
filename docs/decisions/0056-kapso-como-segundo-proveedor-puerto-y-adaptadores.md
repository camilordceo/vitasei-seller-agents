# ADR-0056: Kapso como segundo proveedor — puerto de mensajería y adaptadores

- **Estado:** Aceptada
- **Fecha:** 2026-07-16
- **Sprint:** post-v1 (multi-proveedor)

## Contexto

Todo el backend hablaba **solo con Callbell**. El envío estaba cableado en seis lugares
(`processMessage`, `retarget`, `reactivation`, `videos`, `hotmart/processEvent` y el envío
manual del dashboard), el webhook era uno solo (`/api/webhooks/callbell`) y seis columnas
llevan su nombre (`callbell_message_uuid`, `callbell_channel_uuid`, …).

Se necesita operar una segunda línea en **Kapso**, empezando por **Hotmart** (carritos
abandonados), **sin apagar Callbell**: las dos deben poder correr **a la vez** y probarse en
simultáneo.

Un hallazgo cambia el encuadre: **Kapso no es un proveedor tipo Callbell, es un proxy
Meta-compatible**. Sus endpoints de envío son literalmente la forma de la Cloud API de Meta
(`messaging_product`/`type`/`text.body`/`template.components`) con auth propia (`X-API-Key`).
No es "cambiar de proveedor": es adoptar la forma de Meta detrás de una fachada.

## Decisión

**Un cerebro, dos transportes.** El envío pasa a ser un **puerto** (`MessagingProvider`, en
`lib/messaging/types.ts`) con dos adaptadores (`CallbellProvider`, `KapsoProvider`). Cada
agente elige el suyo en la columna **`agents.provider`** (`callbell` por defecto | `kapso`), y
los dos conviven en el mismo deploy. `providerForAgent(agent)` es el ÚNICO punto donde se
decide cuál es.

El cerebro no se toca: debounce (ADR-0013), gate anti-alucinación (`#ID` debe existir en
`products`), cierre de venta (ADR-0031/0039), retargets, reactivaciones, videos y Hotmart
funcionan igual en los dos proveedores porque solo cambia el transporte.

Consecuencias concretas del diseño:

- **Webhook nuevo** (`/api/webhooks/kapso`) que normaliza el payload de Kapso y desemboca en
  el MISMO `ingestInboundMessage` + `runDebouncedReply`.
- **Enrutamiento por proveedor.** `matchAgent` (Callbell) y `matchKapsoAgent` (Kapso) filtran
  por `provider`. No es cosmético: durante la prueba en paralelo el mismo `whatsapp_number`
  puede existir en dos agentes (uno por proveedor) y el respaldo por número cruzaría las
  líneas —un inbound de Callbell contestado con las credenciales de Kapso—.
- **Reuso de columnas.** `messages.callbell_message_uuid` guarda el id del mensaje **del
  proveedor** (uuid en Callbell, `wamid` en Kapso); `hotmart_templates.template_uuid` y
  `agents.reactivation_template_7d/15d` guardan la **referencia de plantilla del proveedor**
  (uuid en Callbell, `nombre` o `nombre:idioma` en Kapso). El dato cumple exactamente la misma
  función y los espacios de nombres no chocan. La migración 0026 lo deja documentado con
  `comment on column`.
- **Plantillas.** Callbell las referencia por `uuid`; Kapso, por **nombre + idioma**. Las
  variables van **posicionales** ({{1}}, {{2}}…), que es el equivalente exacto de los
  `template_values` de Callbell, así que el orden derivado de `{{nombre}}`/`{{producto}}`
  (ADR-0040) se conserva al migrar una plantilla de un proveedor al otro.
- **Handoff.** Kapso no tiene equipos ni bot propio que apagar: `supportsHandoff = false` y
  `teamUuid`/`botStatus` se ignoran. **El handoff sigue funcionando**: lo que calla a NUESTRA
  IA es `conversations.status = 'handed_off'`, no el proveedor. Lo que se pierde es la
  reasignación a un equipo en la bandeja del proveedor (en Kapso eso se hace desde su inbox).
- **409 "in-flight".** Kapso rechaza un envío si el anterior al mismo destinatario sigue en
  vuelo; Callbell no. Como el flujo manda texto + N imágenes seguidas, el adaptador reintenta
  con backoff (400/1200/2500 ms).
- **Firma obligatoria (fail-closed), a diferencia de Callbell.** Sin secreto configurado, el
  webhook de Kapso **rechaza**. Callbell arrastra el criterio contrario ("sin secreto no se
  valida") por historia; en Kapso no había nada que conservar y el endpoint escribe en la base,
  dispara llamadas pagas a OpenAI y **manda WhatsApps reales desde el número del negocio**: sin
  firma, cualquiera que conozca la URL puede inventarse un inbound y hacer que el bot le escriba
  a quien quiera, a nuestra costa. La firma se valida **antes de la primera escritura**, y los
  rechazos van a los logs de Vercel y no a `events_log` (si no, un request sin firmar tendría
  cómo inflar la tabla).
- **El guardia de host de la credencial de media se compara contra el hostname**, nunca contra
  la URL. La URL del adjunto viene del webhook, así que un patrón probado contra la URL entera
  es explotable con un query param (`https://atacante.com/x?ref=callbell`) para llevarse la
  API key. Esto **también arregla** el camino de Callbell, que tenía el mismo agujero desde
  ADR-0022.
- **Resiliencia de despliegue.** `selectAgents` intenta con las columnas nuevas y **reintenta
  sin ellas ante 42703**, así que el deploy no depende del orden de la migración: sin la 0026,
  `provider` llega `undefined` → `normalizeProviderId` → `callbell` → el comportamiento de hoy.

## Consecuencias

- **Cero duplicación**: Hotmart, retargets, reactivaciones y videos funcionaron en Kapso sin
  reescribir su lógica. Un bug del cierre de venta se arregla una vez, no dos.
- Mover una línea de un proveedor al otro es **cambiar un selector** en el dashboard, no un
  deploy. Volver atrás, también.
- El precio es tocar archivos compartidos con Callbell (que hoy factura). Se mitigó así: el
  adaptador de Callbell es una **envoltura delgada** que delega en el sender actual sin
  cambiarlo, y la suite pasó de 251 a 302 tests **sin modificar ninguno de los existentes**.
- Agregar un tercer proveedor (Meta directo, Twilio…) ya es escribir un adaptador. `provider`
  es TEXTO con CHECK (no enum) justamente para que eso no requiera un `ALTER TYPE`.
- **Deuda aceptada**: los nombres `callbell_*` de las columnas ya no describen su contenido.
  Se documentó en la base y en los tipos en vez de renombrar (ver alternativas).
- **Asimetría de resiliencia entre leer y escribir agentes.** La lectura sobrevive sin la
  migración 0026 (reintento ante 42703 → todo cae a `callbell`), así que el inbound nunca se
  cae. La escritura NO: guardar un agente sin la migración falla con "Falta aplicar la
  migración 0026". Es deliberado — reintentar sin las columnas guardaría el agente **ignorando
  en silencio** el proveedor recién elegido, que es peor que fallar. Mismo criterio que
  `setHotmartAgent` con la 0020.
- **Queda sin verificar contra tráfico real** (la doc de Kapso es ambigua): si `media_url`
  necesita auth y si la firma es del cuerpo crudo o de la re-serialización. El código tolera
  **ambos** casos a propósito. Ver `docs/24` §Pendientes de verificar.

## Alternativas consideradas

- **Fork paralelo del backend** (`lib/kapso/processMessageKapso.ts`, etc.): riesgo cero para
  Callbell, pero duplicaba ~1.500 líneas de lógica de negocio (gate, cierre de venta, ventana
  de 24h, Hotmart). Divergen en semanas y cada arreglo se hace dos veces. Contradice el
  principio del proyecto de menos piezas y más simple. **Descartada explícitamente por el
  dueño del producto** tras plantear el trade-off.
- **Renombrar las columnas** `callbell_*` → `provider_*`: más honesto, pero toca ~15 archivos
  de la ruta crítica de inbound y no cambia ningún comportamiento. El costo/riesgo no se paga
  con la ganancia; queda como limpieza futura.
- **Columnas separadas por proveedor** (`kapso_message_id` aparte de `callbell_message_uuid`):
  duplica el índice de idempotencia y obliga a que cada consulta sepa el proveedor. Un solo
  campo "id del proveedor" es más simple y no colisiona.
- **Usar el buffering nativo de Kapso** en vez de nuestro debounce: ver ADR-0058.
- **Usar los Workflows (IA) de Kapso**: es su motor de agentes. Descartado: nuestra IA, el
  catálogo (`file_search`), el gate y las órdenes ya viven acá. Kapso se usa **solo como
  pasarela**, que es un caso de uso oficial suyo ("Use Kapso as your WhatsApp API"). Ojo: un
  Workflow con trigger de WhatsApp en el número **intercepta los mensajes antes** de llegar al
  webhook, así que no debe haber ninguno activo.
