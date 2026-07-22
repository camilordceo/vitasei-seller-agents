# ADR-0074: Enviar primero, guardar después — y la maquinaria de órdenes al final

- **Estado:** Aceptada
- **Fecha:** 2026-07-22
- **Sprint:** operación

## Contexto

El dashboard mostraba respuestas del bot que **nunca llegaron** ni a Callbell ni al
cliente. Reproducido con el rastro de `events_log` (22/07/2026, cuenta de Colombia):

| conversación | webhook | `reply_generated` | siguiente evento |
|---|---|---|---|
| `f3549d04…` | 13:28:54 | 13:29:40 (**+46 s**) | ninguno |
| `b7744dc1…` | 13:43:04 | 13:43:52 (**+48 s**) | ninguno |
| `fe4ef057…` | 13:11:11 | 13:12:10 (**+59 s**) | ninguno |

No hay `text_sent`, ni `image_sent`, ni `process_error`: la invocación fue **matada por
el `maxDuration = 60`** del webhook, así que ni siquiera alcanzó a correr el `catch` que
registra el error. En una conversación de la misma tanda con una generación de 24 s todo
salió bien — el corte es el reloj, no el contenido.

Dos decisiones del código convertían ese timeout en una **mentira en el dashboard**:

1. El outbound se guardaba en `messages` **antes** de enviarlo (era el único camino de
   salida que lo hacía así; reactivaciones, retargets, videos, Hotmart y el envío manual
   ya guardaban después, con el `uuid` del proveedor). Si el envío no ocurría, la fila
   quedaba igual y el hilo la pintaba idéntica a una entregada.
2. Entre la generación y el envío corría toda la maquinaria de cierre: red de seguridad
   de la orden, **`extractOrder` (otra llamada al modelo)**, cancelación de seguimientos y
   aviso al dueño. Es decir, lo único urgente —la respuesta al cliente— esperaba detrás de
   lo que puede esperar.

El presupuesto se lo comen 12 s de debounce + una llamada a Responses con `file_search`
sobre un catálogo grande (30–50 s). Con 60 s no hay margen.

## Decisión

1. **`maxDuration = 300`** en los webhooks de Callbell y Kapso (ya subido en ADR-0073 por
   el mismo techo, visto desde el video por palabra clave).
2. **El envío va primero.** Tras el gate y la ventana de 24 h se envía; solo después
   corren categoría de producto, link de Addi, videos, `#llamada`, órdenes, aviso al dueño,
   handoff y seguimientos.
3. **El outbound se guarda DESPUÉS del envío**, con el `uuid` del proveedor — como todos
   los demás caminos de salida. Si la función muere antes, no queda un mensaje fantasma.
4. **Si el envío falla de verdad**, el texto se guarda marcado con `#no-enviado`
   (`UNSENT_TAG`), se registra `send_failed` y **no** se crean órdenes ni se agenda nada.
   El hilo lo pinta como *"No entregado — el cliente no lo recibió"* y el operador
   reintenta con el botón que ya existe.
5. **Un reintento** en el envío principal (`sendWithRetry`) para cortes de red y 5xx. Un
   `HTTP 4xx` no se reintenta: volvería a fallar igual y quema tiempo de la función.
6. Las **imágenes adicionales** pasan a ser best-effort (`image_send_failed`): que una foto
   falle ya no tumba la orden ni los seguimientos.

## Consecuencias

- El hilo del dashboard deja de mentir: lo que se ve como enviado, salió; lo que no, se ve.
- La respuesta al cliente llega antes (deja de esperar a `extractOrder`).
- Fuera de la ventana de 24 h ya no se guarda un mensaje que nunca sale; el texto que se
  iba a enviar queda como `preview` en el evento `out_of_window`.
- Si la función muere **entre** el envío y el guardado (ventana de ~1 s), el cliente recibe
  el mensaje y el hilo no lo muestra. Es el error opuesto y mucho más raro; se prefiere
  callar de más antes que afirmar de más.
- Los mensajes fantasma anteriores a este cambio siguen en la base sin `uuid`: no se tocan.

## Alternativas consideradas

- **Solo subir `maxDuration`.** Corrige la tanda de hoy, no la clase de bug: cualquier
  fallo del proveedor seguiría apareciendo como entregado.
- **Columna `delivery_status` en `messages`.** Más limpia, pero exige una migración
  aplicada a mano antes del deploy; con `tags` el fix entra con el deploy y sin pasos.
- **Cola/worker aparte para el envío.** Más infraestructura de la que este producto quiere
  (ver ADR-0012/0013); el problema era de orden de operaciones, no de arquitectura.
