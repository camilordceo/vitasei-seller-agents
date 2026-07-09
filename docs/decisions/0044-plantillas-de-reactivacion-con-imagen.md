# ADR-0044: Plantillas de reactivación con imagen (header) opcional por etapa

- **Estado:** Aceptada
- **Fecha:** 2026-07-09
- **Sprint:** 6 (continuación — crecimiento/conversión)

## Contexto
Las reactivaciones por plantilla (7/15 días, ADR-0021/0030) se enviaban **siempre** como
`type:"text"` (`sendTemplate` con `content.text`): solo texto, sin imagen. Callbell/WhatsApp
permite plantillas aprobadas con **header de imagen**, donde el archivo se **elige al momento del
envío** (doc de soporte de Callbell). Se quiere poder configurar cada etapa (día 7 y día 15) **con
o sin imagen** desde el dashboard y que el envío (el payload a Callbell) sea distinto según eso, sin
tocar la ruta crítica de inbound ni requerir redeploy.

## Decisión
- **Link de imagen OPCIONAL por etapa y por agente:** nuevas columnas
  `agents.reactivation_image_7d` / `reactivation_image_15d` (URL; **NULL = plantilla de solo
  texto**). Migración `0022_agent_reactivation_images.sql` (idempotente).
- **Payload distinto en `sendTemplate`** (nuevo `imageUrl?`):
  - **Sin imagen** (comportamiento actual): `type:"text"`, la variable única en `content.text`.
  - **Con imagen:** `type:"image"`, el header en `content.url` (como `sendImage`) y las variables del
    cuerpo en `template_values` — **no** en `content.text`, que en un mensaje de imagen sería el
    caption y chocaría con el cuerpo de la plantilla. Si solo hay una variable (el nombre) y no se
    pasó `templateValues`, se usa `[text]`.
- **Lectura resiliente, fuera de `AGENT_COLS`:** las URL se leen en una consulta aparte
  (`loadReactivationImages`) igual que las instrucciones de retarget (ADR-0043) y la marca de Hotmart
  (ADR-0041). Si falta la migración (42703) devuelve nulls → se envía como solo texto y la **ruta
  crítica de inbound queda intacta**.
- **Dashboard (Retargets → Reactivaciones):** cada etapa es una tarjeta con UUID + **link de imagen**
  opcional, un **badge "Con imagen / Solo texto"** y vista previa. La query del dashboard y el Server
  Action `updateReactivationSettings` son resilientes a la ventana de migración (reintentan sin las
  columnas de imagen; el link se valida http(s)).
- **Rastro:** el outbound se registra como `image` (con `media_url`) cuando lleva imagen; el evento
  `reactivation_sent` guarda `hasImage`.

## Consecuencias
- **Bueno:** cada marca decide por etapa si la plantilla va con imagen o solo texto, sin redeploy;
  no toca `AGENT_COLS` (inbound a salvo); degradación limpia si falta la migración; el cambio de
  payload queda fijado con tests del sender (`sendTemplate`, 4 casos).
- **Malo / atado a futuro:**
  - La plantilla con imagen debe **aprobarse en Callbell/Meta con header de imagen**; el UUID y el
    link deben corresponder. Igual que con el texto, **requiere una prueba real** al encender (el mapeo
    exacto `content.url` + `template_values` depende de la cuenta; ver la nota de riesgo en docs/14).
  - Si la migración `0022` no está aplicada, el link se ignora silenciosamente al guardar (se guardan
    UUID y ON/OFF); hay que aplicar la migración para que la imagen tenga efecto.
  - El link debe ser una URL pública y directa a la imagen (Callbell la reenvía tal cual).

## Alternativas consideradas
- **(a) Agregar las columnas a `AGENT_COLS`:** menos consultas, pero arriesga romper TODO el inbound
  (42703) en la ventana de migración por un feature que está OFF por defecto. Descartada por la misma
  razón que ADR-0041/0043.
- **(b) Meter la variable del nombre en `content.text` también con imagen:** en un mensaje de imagen
  `content.text` es el caption; mezclarlo con el cuerpo de la plantilla es ambiguo y arriesga un
  doble texto. Se usa `template_values` para el cuerpo cuando hay imagen.
- **(c) Subir la imagen a Storage desde el dashboard:** innecesario y costoso; basta un link público
  (mismo criterio que la imagen de producto del inventario, ADR-0042, y los videos, ADR-0038).
