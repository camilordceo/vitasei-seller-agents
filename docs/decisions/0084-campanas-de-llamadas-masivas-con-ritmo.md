# ADR-0084: Campañas de llamadas masivas — el ritmo lo pone el worker, no la cola

- **Estado:** Aceptada
- **Fecha:** 2026-07-23
- **Sprint:** —

## Contexto

Hasta ahora **toda** llamada nacía de una conversación de WhatsApp: la cadencia del agente, el
botón manual del detalle, o un `#llamada` del cliente. El negocio necesita lo contrario:
**llamar en frío una lista** —un CSV o un Excel con 100 números— a un ritmo controlado, del
estilo "una llamada cada 2 minutos".

Tres cosas hacían falta y ninguna existía: cargar la lista, marcar el ritmo, y poder frenar.

## Decisión

**1. Una campaña NO es un motor nuevo.** `voice_campaigns` guarda la lista (nombre, agente,
intervalo, objetivo, cuándo arranca) y sus números se escriben como filas normales de
`voice_calls` con `campaign_id` y `trigger = 'campaign'`. De ahí en adelante las coloca el mismo
cron, con las mismas guardas (país, horario del agente, claim atómico), la misma reconciliación
y el mismo cierre — incluido el resultado → orden de ADR-0083.

**2. El ritmo se aplica en el WORKER, no solo al agendar.** Al crear la campaña cada fila queda
con su hora (`inicio + i × intervalo`), pero antes de colocar cualquier llamada de campaña el
worker comprueba **cuánto pasó desde la anterior REALMENTE colocada** y, como mucho, coloca una
por ciclo. Sin esto, un cron caído una hora convierte 30 llamadas "vencidas" en 30 llamadas
simultáneas — justo lo que un ritmo existe para impedir, y la forma más rápida de que marquen
como spam el número saliente.

**3. El cron de llamadas pasa de cada 5 minutos a cada minuto.** El ritmo no puede ser más fino
que la frecuencia del cron; con `*/5` un "cada 2 minutos" era una ficción.

**4. Una llamada de campaña no tiene conversación.** `voice_calls.conversation_id` y
`contact_id` pasan a ser opcionales. La conversación (y el contacto) **se crean solo si hay
venta**, con `source = 'voice'`. Crear 100 conversaciones vacías por adelantado inflaría los
chats de los reportes y el ROAS —que divide inversión entre chats— con gente que nunca escribió.

**5. Guardas propias de llamar en frío:** no se agenda un número que ya tiene una llamada viva
(programada o en curso), no se llama a quien ya compró (cualquier orden no cancelada de ese
teléfono), y se deduplica el archivo.

**6. El archivo se lee en el servidor, y se revisa antes de lanzar.** El formulario obliga a un
paso de revisión: cuántos números entendimos, cuáles no y con qué motivo, cuántos repetidos y
cuánto va a durar la campaña. Solo entonces se habilita "Lanzar".

**7. El lector de Excel es propio.** Un `.xlsx` es un ZIP con XML adentro y Node ya trae `zlib`:
`lib/agent/xlsx.ts` lee la primera hoja y sus cadenas compartidas en ~150 líneas. Alcance
deliberado: valores como texto, sin fórmulas, estilos ni fechas. El `.xls` viejo (binario) se
rechaza con un mensaje que dice qué hacer.

**8. Pausar, reanudar y cancelar.** Pausar detiene la colocación sin tocar la cola; cancelar
tumba las pendientes. Una campaña que se queda sin pendientes se marca "terminada" sola.

## Consecuencias

**Lo bueno**

- Todo lo que ya funcionaba se hereda gratis: transcripción, grabación, extractores, costo por
  minuto, reconciliación sin webhook, y la orden automática cuando el resultado es compra.
- El atraso no se convierte en avalancha: una campaña que estuvo parada drena a su ritmo.
- El operador ve la lista como la entendimos **antes** de que suene el primer teléfono.
- Los reportes de chats y el ROAS no se contaminan con números fríos que no contestaron.

**Lo malo / lo que queda atado**

- **La precisión del ritmo es de ~1 minuto** (la frecuencia del cron). Un "cada 30 segundos" no
  es posible hoy, y está bien: el rango útil del negocio son minutos.
- El cron corre 5 veces más seguido (1.440 invocaciones/día). Son baratas y salen temprano si no
  hay nada vencido, pero es consumo que antes no existía.
- Solo se coloca **una llamada por campaña y por ciclo**: con varias campañas activas todas
  avanzan, pero ninguna puede ir más rápido que 1/minuto aunque su intervalo sea menor.
- El lector de Excel es mínimo. Un archivo con hojas raras, celdas con fórmulas o formatos
  exóticos puede leerse mal; la salida siempre disponible es exportar a CSV, y la UI lo dice.
- Llamar en frío tiene su propio riesgo regulatorio y reputacional. El sistema respeta horario y
  país del agente, pero **no** lleva lista de "no llamar": si aparece, es una feature aparte.

## Alternativas consideradas

- **Tabla y worker propios para campañas.** Descartado: duplicaría marcado, reconciliación,
  cierre, costos y dashboard — la parte cara y ya probada.
- **Crear contacto y conversación para cada número al cargar.** Descartado por lo que le hace a
  los reportes (chats y ROAS) y porque una conversación sin un solo mensaje no es una
  conversación.
- **Confiar solo en `scheduled_at` para el ritmo.** Descartado: es correcto mientras nada falle,
  y el día que el cron se cae dispara la cola entera de golpe.
- **Sumar una librería de hojas de cálculo.** Descartado: megabytes y superficie de CVE para lo
  que aquí es "dame la columna de teléfonos".
- **Parsear el archivo en el navegador.** Descartado: el servidor tiene que releerlo igual para
  no confiar en una lista que puede venir editada del cliente.
- **Encolar en un servicio externo (colas/jobs).** Descartado por el principio del proyecto:
  menos servicios. Un cron por minuto y una columna `placed_at` bastan.
