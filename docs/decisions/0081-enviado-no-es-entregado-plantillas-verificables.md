# ADR-0081: "Enviado" no es "entregado" — plantillas de reactivación verificables

- **Estado:** Aceptada
- **Fecha:** 2026-07-22
- **Sprint:** 6 (continuación — crecimiento/conversión)

## Contexto
Las reactivaciones de día 7 de Vitasei CO se estaban enviando y **nadie las recibía**.
Los datos de producción (22/07/2026):

- Hasta el 18/07 **todas** fallaban con `Callbell send HTTP 400 {"metadata":["must be string"]}`
  (82 filas `failed`); eso se corrigió en `16d3ad7`.
- Desde el 18/07 Callbell **acepta** el envío: 339 filas `sent`, evento `reactivation_sent`
  con `status: "enqueued"`.
- Pero de 120 reactivaciones enviadas, **0** conversaciones tuvieron un inbound posterior;
  de 120 retargets normales, 11 (9%) sí. La plantilla no está llegando.
- La etapa de 15 días **nunca se ha enviado**: la primera vence el 25/07 (el feature se
  encendió el 10/07). Su configuración nunca se ha probado contra WhatsApp.

Dos causas de fondo:

1. **`enqueued` no es entrega.** Es "Callbell aceptó el envío". Si WhatsApp lo rechaza
   después, el mensaje muere y **no dejábamos rastro**: el webhook descartaba el evento
   `message_status_updated` (solo procesa `message_created` inbound), así que el dashboard
   seguía diciendo "enviado" y cobrando el costo de la plantilla. Volábamos a ciegas.
2. **El payload de la plantilla con imagen nunca se probó.** ADR-0044 decidió que con
   header de imagen la variable viajara **solo** en `template_values` y NO en
   `content.text` (por miedo a que fuera un caption), y dejó escrito que el mapeo exacto
   "requiere una prueba real". Esa prueba nunca se hizo. La doc de Callbell pone el valor
   de la variable **siempre** en `content.text` — su ejemplo de varias variables manda
   `content.text` **y** `template_values`. La plantilla de día 7 es la única con imagen y
   es justo la que no llega.

Además, el ciclo de aprendizaje era de **7 días**: para saber si una plantilla funciona
había que esperar a que venciera y ver si alguien respondía.

## Decisión
1. **La variable viaja en `content.text` también con imagen** (`sendTemplate`), además de
   en `template_values`: la forma documentada por Callbell, la misma para las dos etapas.
2. **Capturar el desenlace real:** el webhook procesa `message_status_updated` antes del
   filtro de inbound. Con `failed`/`mismatch` escribe un evento `outbound_failed` en el
   hilo (con la razón que da WhatsApp) y, si el mensaje era una reactivación, corrige su
   fila de `sent` a `failed`. Los estados buenos se ignoran (llegan por miles y no
   explican nada). No toca la ruta crítica del inbound y nunca rompe el 200.
3. **Diagnóstico en el dashboard** (Seguimientos → Reactivaciones):
   - **Revisar plantillas**: lee `GET /templates` de la cuenta del agente y avisa si el
     UUID no existe ahí, si no está aprobada, si la plantilla lleva header de imagen y no
     hay link (o al revés) o si pide más variables de las que mandamos.
   - **Enviar prueba**: manda la plantilla a un número ahora, con o sin imagen, y consulta
     `GET /messages/status/:uuid` unos segundos después para mostrar el desenlace REAL
     (`delivered` / `failed` + razón), no el "aceptado" del envío.

## Consecuencias
- **Bueno:** el ciclo de aprendizaje pasa de 7 días a 30 segundos; el día 15 se puede
  validar antes de que venza el primero; un envío que WhatsApp rechaza deja de contarse
  como éxito (dashboard y costos dicen la verdad); el interruptor "con/sin imagen" de la
  prueba aísla el header sin tocar código.
- **Malo / atado a futuro:**
  - El registro de fallos **exige suscribir el evento `message_status_updated`** en la
    configuración de webhooks de Callbell. Sin eso seguimos ciegos (pero la prueba manual
    sigue funcionando, porque consulta el estado por API).
  - `getMessageStatus` y `listTemplates` son de Callbell: con Kapso la prueba solo muestra
    lo que devolvió el envío. Se sube al puerto `MessagingProvider` cuando haga falta.
  - Si Callbell tratara `content.text` como caption en una plantilla con imagen, la prueba
    lo mostrará en el primer intento — y el arreglo es quitar el link de imagen mientras se
    aprueba una plantilla de header correcto.

## Alternativas consideradas
- **(a) Dejar el payload como está y solo agregar diagnóstico:** honesto pero deja el
  feature roto una semana más; la forma con `content.text` es la documentada y el estado
  actual entrega 0%.
- **(b) Mandar la reactivación como solo texto siempre (borrar la imagen):** entregaría,
  pero renuncia a la imagen sin saber si era la culpable. La prueba manual permite decidir
  con datos.
- **(c) Registrar TODOS los estados (`sent`, `delivered`, `read`):** miles de filas de ruido
  en `events_log` por un dato que casi nunca se mira. Solo los desenlaces malos.
- **(d) Reconciliar por cron consultando el estado de cada envío:** más llamadas y más
  código para lo que el webhook da gratis; queda como plan B si Callbell no permite
  suscribir el evento.
