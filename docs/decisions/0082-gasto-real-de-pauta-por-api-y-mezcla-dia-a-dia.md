# ADR-0082: Gasto real de pauta por API, y mezcla día a día con el costo por chat

- **Estado:** Aceptada
- **Fecha:** 2026-07-22
- **Sprint:** —

## Contexto

El retorno del dashboard (ADR-0065) calcula la inversión como `chats × agents.cost_per_chat`:
un promedio que el dueño teclea a mano por agente. Sirvió para tener un ROAS el primer día,
pero tiene tres problemas que ya se notan:

1. **No es plata, es una hipótesis.** Un mes en que la pauta subió 40 % se sigue leyendo con
   el mismo promedio del mes pasado, y el ROAS miente sin avisar.
2. **No tiene día.** Un martes en que se quemó presupuesto sin vender se diluye en el
   promedio; el gráfico de 14 días dibuja una inversión perfectamente plana, que es una
   forma elegante de no decir nada.
3. **Alguien ya tiene el dato.** Las cuentas de anuncios están conectadas en otro producto
   nuestro, donde llega el gasto real, las impresiones, los clics y los leads.

Además, el promedio manual sí tiene un rol legítimo: es el piso cuando el dato real todavía
no llega (agente nuevo, integración a medio conectar, un envío que falló anoche).

## Decisión

**1. Una API de ingesta propia**, `POST /api/ingest/ad-spend`, autenticada con un Bearer
token (`AD_SPEND_API_KEY`), que recibe lotes de filas con grano **día × agente × plataforma ×
campaña** y las guarda en la tabla `ad_spend` (migración 0031). Contrato completo en
`docs/28-api-gasto-en-pauta.md`.

**2. El envío REEMPLAZA, no suma.** La llave de idempotencia es
`(agent_id, date, platform, campaign_id)`. Reenviar los últimos días es el uso *correcto*,
porque las plataformas reexpresan el gasto reciente por las ventanas de atribución.

**3. La inversión se resuelve día a día, no en bloque.** Para cada agente y cada día: si hay
gasto reportado, se usa ese; si no, se estima con `costPerChat × chats de ese día`. Nunca los
dos sobre el mismo día. Los días con gasto reportado y **cero chats** también suman inversión.

**4. La pantalla dice de dónde salió cada peso.** Cada fila del ROAS trae una etiqueta
(`real` / `mixto` / `estimado`), el gráfico marca los días con dato reportado, y una nota
dice cuántos días hay y hasta cuándo — en ámbar si el último dato tiene 2 días o más.

**5. Los `leads` de la plataforma se guardan pero NO reemplazan los chats.** Se muestran al
lado, como brecha.

## Consecuencias

**Lo bueno**

- El ROAS pasa a ser dinero pagado en vez de una hipótesis, sin que nadie tenga que borrar
  ni migrar la configuración que ya existe.
- Un agente que nunca configuró costo por chat obtiene retorno legible en cuanto llega el
  primer envío: el gasto real por sí solo basta.
- La mezcla día a día hace que un envío fallido degrade el reporte en un solo día en vez de
  apagarlo entero.
- El feed caído se ve: la nota dice hace cuántos días llegó el último dato. Un reporte con
  datos viejos se ve igual de bien que uno al día, y ese es justo el peligro.
- La brecha *leads vs chats* aparece gratis y es diagnóstico: mucha diferencia significa
  clics que nunca abrieron conversación.

**Lo malo / lo que queda atado**

- **No hay ROAS por campaña.** Guardamos el gasto con `campaign_id`, pero las conversaciones
  no traen el `ad_id` de origen, así que atribuir ventas a campañas sería inventar. Cuando la
  ingesta capture el anuncio de origen (CTWA), el dato ya está y el reporte se abre solo.
- La lectura mezcla dos verdades con distinta precisión en la misma cifra. Se acepta porque
  la etiqueta lo dice en voz alta; la alternativa —dos columnas separadas— parte cada número
  de la pantalla en dos y no se puede sumar.
- Monedas: se rechaza en la ingesta lo que no tenga tasa (`COP`/`USD`/`MXN`). Es deliberado:
  guardar un EUR que después el reporte excluye en silencio es peor que un `400` inmediato.
- Otra credencial que rotar y otra superficie pública de escritura. Se mitiga con
  fail-closed: sin `AD_SPEND_API_KEY` el endpoint responde `503`, no queda abierto.

## Alternativas consideradas

- **Conectarnos nosotros a la API de Meta/Google.** Descartado: las cuentas ya están
  conectadas en otro producto nuestro, que además maneja los tokens y sus renovaciones.
  Duplicar esa integración es duplicar el problema más frágil de todos.
- **Que el otro producto escriba directo en Supabase.** Descartado: acopla su esquema al
  nuestro y le entrega una service role key. Un endpoint con contrato explícito nos deja
  validar, versionar y auditar (`raw` guarda el payload original).
- **Reemplazar del todo el costo por chat manual.** Descartado: quedaría un ROAS que se
  apaga cada vez que falle un envío, y sin salida para agentes cuya pauta no está en el
  producto de anuncios.
- **Insert-only con un `total` recalculado.** Descartado por la reexpresión del gasto: sin
  upsert, reenviar un día duplica la inversión, y ese error es invisible en el reporte.
- **Sumar real + estimado en el mismo día.** Descartado por lo mismo: contaría la pauta dos
  veces justo en los días mejor documentados.
- **Grano por hora.** Descartado: las plataformas no lo entregan de forma estable y el
  reporte no lo pide.
