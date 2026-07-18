# ADR-0061: El webhook de Synthflow es un aviso; la API es la fuente de verdad

- **Estado:** Aceptada
- **Fecha:** 2026-07-18
- **Sprint:** 8

## Contexto

Cuando termina una llamada necesitamos el desenlace: duración, transcript, grabación y los
datos extraídos. Synthflow ofrece un **post-call webhook**. Al verificarlo contra su doc y
contra la cuenta real aparecieron cuatro problemas:

1. **La firma cubre solo el `call_id`, no el cuerpo.** Su propia doc lo dice: *"Synthflow signs
   the `call_id` with that key"*. Eso autentica al emisor pero **no da integridad del payload**:
   una firma válida no prueba que el cuerpo no fue alterado.
2. El nombre del header en la doc es `HTTP_SYNTHFLOW_SIGNATURE` — la grafía **WSGI/Django** de
   una variable de entorno, no un header de red. El nombre real en el cable es incierto.
3. El webhook **no trae costo**, y **no trae resumen**: `analysis.call_summary === "true"` es un
   flag de juez, no texto.
4. Webhook y API **no coinciden**: el estado es `call.status` en uno y `call_status` en el otro;
   `start_time` es ISO-8601 en uno y epoch-ms en el otro.

Encima, el `external_webhook_url` se configura **por assistant**, y los assistants de esta
cuenta ya apuntan a Bubble (ADR-0060): no podemos asumir que el webhook vaya a llegar.

## Decisión

El webhook es **solo un aviso de que algo pasó**. Ante un webhook:

1. Se valida la firma (case-insensitive contra `synthflow-signature`,
   `x-synthflow-signature` y `http_synthflow_signature`), calculada sobre el **`call_id`**.
2. Se extrae **únicamente el `call_id`** del cuerpo. Nada más del payload se cree.
3. Se resuelve la llamada por `synthflow_call_id` en **nuestra** tabla (así sabemos a qué agente
   y conversación pertenece, sin depender del payload).
4. Se hace `GET /v2/calls/{call_id}` **con la key del agente** y de ahí salen todos los datos.

Además, el cron **reconcilia** las llamadas `placed` sin desenlace consultando la misma API.

## Consecuencias

**Bueno**
- La feature **funciona aunque el webhook nunca se configure**. Con assistants compartidos que
  ya apuntan a Bubble, esto no es una red de seguridad: es el camino principal realista.
- Un payload falsificado no puede inyectar transcript, costo ni datos extraídos: lo peor que
  logra es que consultemos por un `call_id` que no existe o que no es nuestro.
- Las desalineaciones webhook↔API dejan de importar: **solo parseamos la forma de la API**, una
  sola vez, en un solo módulo.
- El desenlace se resuelve una sola vez: webhook y reconciliación entran por la misma función,
  idempotente por `synthflow_call_id`.

**Malo / atado**
- Una llamada extra a la API por cada llamada telefónica (despreciable frente al costo del minuto).
- El cierre por reconciliación puede tardar hasta un ciclo de cron si el webhook no llega.
- Si Synthflow algún día firma el cuerpo entero, esta decisión queda conservadora de más — pero
  no incorrecta.

## Alternativas consideradas

- **Confiar en el payload del webhook.** Descartada: con firma que no cubre el cuerpo, sería
  aceptar transcript, minutos y datos de cliente desde una fuente no verificada, en un endpoint
  público. Y aun así habría que resolver el costo por otro lado.
- **Solo polling, sin webhook.** Descartada: funciona, pero agrega latencia innecesaria al
  cierre cuando el webhook sí está configurado. Nos quedamos con los dos, misma función.
- **Rechazar si no hay secreto configurado (fail-closed, como Kapso ADR-0056).** Matizada: el
  endpoint fail-closed sigue, pero acá el riesgo es menor porque **el cuerpo no se usa**. La
  firma protege contra que un tercero nos haga gastar llamadas a la API, no contra inyección.
