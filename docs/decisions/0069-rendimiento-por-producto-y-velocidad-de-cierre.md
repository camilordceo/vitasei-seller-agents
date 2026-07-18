# ADR-0069: Rendimiento por producto (plata, no solo tasa) y velocidad de cierre

- **Estado:** Aceptada
- **Fecha:** 2026-07-18
- **Sprint:** mejoras de dashboard

## Contexto

Reportes ya decía *cuántas* conversaciones de cada producto convertían, pero no *cuánta plata*
traía cada una: dos productos con la misma conversión pueden diferir 10× en facturación. Además,
los ítems de las órdenes (`order_items`: SKU, cantidad, precio) no se explotaban en ningún
reporte — el "producto" de una conversación es su categoría de origen (qué preguntó el cliente),
que no es lo mismo que lo que terminó saliendo en la orden. Y ningún cuadro respondía la
pregunta operativa *¿qué tan rápido cierra la IA?*, aunque la data existe desde siempre
(`conversations.created_at` → `orders.created_at`).

También había una inconsistencia visual: la serie por día del ROAS se construía del más viejo al
más nuevo, mientras todos los demás gráficos de la página ponen hoy arriba.

## Decisión

Tres lecturas nuevas en Reportes, todas con la lógica pura en `report.ts` (testeable) y la
moneda homologada con el criterio de ADR-0068 (la del agente filtrado; consolidado en COP, con
la tasa a la vista cuando hubo conversión):

1. **Rendimiento por producto** (antes "Conversión por producto"): a la tasa se suman
   **órdenes**, **ventas** y **valor/chat** (ventas ÷ conversaciones) por categoría, ordenado
   por plata. Debajo, un gráfico de **% de conversaciones vs. % de ventas** por producto:
   ambas barras están en la misma unidad (%), así que un producto con mucha barra de chats y
   poca de ventas se lee de un vistazo como atención que no se vuelve plata.
2. **Productos más vendidos**: ranking por SKU desde `order_items` — unidades, órdenes
   distintas, ventas, ticket por orden y **tasa de cancelación** por producto. Los ítems sin
   precio cuentan unidades pero no suman ventas, y se dice en pantalla cuántos son.
3. **Velocidad de cierre**: minutos entre el primer contacto (creación de la conversación) y
   la **primera** orden no cancelada de esa conversación. Se reporta la **mediana** (no el
   promedio: un lead que volvió a los 20 días taparía que el resto cierra en minutos), la
   distribución en 6 buckets (≤15 min … >3 días) y el % dentro de la primera hora / 24 h.
   Las órdenes siguientes de una misma conversación se cuentan aparte como **recompras**.

La serie del ROAS pasa a ir del más reciente al más viejo, igual que el resto de la página.

## Consecuencias

- El equipo puede decidir pauta por producto con plata, no solo con tasas, y ver qué SKU se
  cae en cancelaciones.
- La velocidad de cierre usa `conversations.created_at` como ancla. Como la ingesta reutiliza
  la conversación por contacto, para un cliente viejo esa ancla es su primer contacto de
  siempre; medir solo la **primera** orden de cada conversación evita inflar el número con
  recompras, pero un lead que compró meses después de escribir sí aparece como cierre lento
  (es la verdad: ese lead costó eso en tiempo).
- "Rendimiento por producto" atribuye TODA la venta de la conversación a su categoría de
  origen; si el cliente terminó comprando otra cosa, la plata queda en la categoría por la que
  llegó. Para lo que salió de verdad está el ranking por SKU al lado.

## Alternativas consideradas

- **Medir velocidad desde el último inbound antes de la orden.** Más "justo" con leads viejos,
  pero exige barrer `messages` contra cada orden y mide otra cosa (velocidad de la última
  ráfaga, no del ciclo de venta). La mediana ya absorbe los extremos.
- **Promedio en vez de mediana.** Un solo lead de 30 días arrastra el promedio a horas aunque
  el 80% cierre en minutos; la mediana cuenta la historia real.
- **Cruzar categoría de conversación con SKU vendido (matriz origen → producto).** Es la
  versión completa, pero necesita mapear categorías a SKUs (hoy son texto libre) y una UI de
  matriz; las dos vistas separadas responden el 90% con lo que ya hay.
