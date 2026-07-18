# 26 · Retorno (ROAS): costo por chat y cuánto devuelve

Cómo leer y configurar el retorno del dashboard. Decisión y trade-offs: **ADR-0065**.

## La idea en una línea

Cada conversación cuesta plata (pauta). El retorno es **cuánto vendió esa conversación dividido
por lo que costó traerla**. Un ROAS de 3× significa: por cada $1 de pauta, entran $3 en ventas.

## Configurarlo (una vez por agente)

1. Entra a **Dashboard → Agentes → el agente**.
2. Abre la sección **WhatsApp** y busca el bloque **Costo por chat**.
3. Pon lo que te cuesta traer una conversación a ese número y la moneda del mercado.
   - Colombia hoy: `1000` con moneda `COP`.
   - Se aceptan formatos con separadores: `1.000`, `1,000` y `$ 1000` guardan lo mismo.
4. Guarda. La sección **Retorno (ROAS)** de Reportes ya calcula.

Dejarlo **vacío** es válido: el agente aparece en la tabla con sus chats y sus ventas, pero sin
retorno. Es a propósito — mejor un hueco visible que un número inventado.

> Requiere la migración `0028_agent_cost_per_chat.sql`. Sin aplicarla, guardar el agente avisa
> exactamente cuál falta, y Reportes sigue funcionando (todos los agentes salen "sin configurar").

## Qué significa cada columna

| Columna | Qué es |
| --- | --- |
| **Chats** | Conversaciones donde el cliente **escribió** al menos una vez. Una conversación que llegó pero nunca escribió no se cobra. |
| **Costo/chat** | Lo que configuraste. En la fila consolidada es el costo **mezclado** (inversión ÷ chats), no el promedio simple: un agente con 10× más chats pesa 10× más. |
| **Inversión** | Chats × costo por chat. |
| **Ventas** | Órdenes **no canceladas** (misma base que "Órdenes generadas", para que los dos cuadros cuadren). El número gris al lado es cuántas órdenes son. |
| **Costo/venta** | Inversión ÷ órdenes. Es el CPA: cuánto costó cerrar cada venta. |
| **ROAS** | Ventas ÷ inversión. Verde ≥ 2×, ámbar entre 1× y 2×, rojo por debajo de 1× (pierde plata). |
| **ROAS confirm.** | Igual, pero contando solo lo **confirmado**. La lectura conservadora: lo generado todavía puede caerse. |

El gráfico son los últimos 14 días con dos barras a la misma escala: **rojo = inversión**,
**verde = ventas**. Si el verde le gana al rojo, ese día pagó.

## Dos reglas que evitan números falsos

- **El costo se imputa el día en que llegó la conversación**, no el día en que el cliente volvió
  a escribir. Es cuando se pagó por el lead.
- **Nunca se suman monedas distintas.** Si el alcance mezcla COP y USD, la tabla muestra cada
  fila pero no consolida ni grafica, y lo dice. Filtra por un agente para ver su serie.

## Lo que este número NO es

- **No tiene historia de costos.** Es el valor vigente aplicado a todo el histórico: si cambias
  el costo por chat, el pasado se recalcula con el nuevo. Para ROAS histórico exacto haría falta
  costo con vigencia (ver "Alternativas" en ADR-0065).
- **No distingue campañas.** Atribuye por conversación, no por anuncio. Sirve para decidir por
  mercado, no para optimizar creativos.
- **No incluye el costo de la IA.** Ese va aparte, en la sección **Costo IA** de Reportes
  (tokens, visión, audio y llamadas), y es dos órdenes de magnitud menor que la pauta.
