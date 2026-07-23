# ADR-0087: Rango de fechas global en Reportes (y conversaciones por día por agente)

- **Estado:** Aceptada
- **Fecha:** 2026-07-23
- **Sprint:** —

## Contexto

Reportes mostraba ventanas fijas: las series "por día" cubrían siempre los últimos
14 días, la foto semanal 8 semanas, y los titulares/agregaciones (ventas confirmadas,
por estado, por método, mapa de calor, productos, velocidad de cierre) eran
**históricos** (todo lo que existe). No había forma de preguntar "¿cómo estuvo del 1 al
15 de julio?" ni de acotar una campaña a sus fechas.

Además faltaba una lectura de **top del embudo**: cuántas conversaciones ENTRAN por día
y de qué agente/marca. El dueño la pidió para decidir dónde está entrando el volumen y
para armar **llamadas masivas** por agente.

El riesgo del cambio: los números de plata (ROAS, ventas, homologación de monedas)
llegan al dueño del negocio; un rango mal aplicado da un retorno falso.

## Decisión

1. **Rango de fechas global, opt-in.** Un control arriba de Reportes con atajos
   (14 / 30 / 90 días) y un rango exacto Desde/Hasta (días calendario, hora Colombia,
   ambos inclusivos). Sin rango seleccionado, la página se comporta **igual que antes**
   (histórico + series de 14 días): el rango no cambia el default, se activa a demanda.

2. **Con rango activo, TODA la página se recalcula dentro de él** —titulares, cortes,
   series por día, mapa de calor, productos, velocidad de cierre, ROAS (filas + serie),
   semana a semana, costo IA y la sección nueva— **salvo dos excepciones deliberadas:**
   - Las **tarjetas móviles "Hoy / 7 / 30 días"** siguen siendo relativas a hoy (son un
     vistazo rápido, no una ventana editable).
   - La **Escala** (economía por chat, proyección del mes, crecimiento semanal) sigue
     relativa a hoy: "proyección del mes" no tiene sentido para un rango a medida. Se
     enuncia en pantalla.

3. **Nueva sección "Conversaciones por día · por agente":** barras apiladas por agente
   con un **toggle Gráfico/Tabla** (la misma data en dos vistas — la tabla se copia para
   armar llamadas). Una conversación cuenta el día de su **primer contacto**
   (`created_at`), la misma base que los chats del ROAS.

Implementación: un `ReportRange` puro (`fromKey`/`toKey`) y helpers en `report.ts`; las
funciones `summarize*` reciben un `range` opcional que solo cambia la ventana de la
serie y filtra los hechos dentro del rango (las tarjetas móviles se calculan aparte con
todos los hechos). Las queries filtran los hechos por `created_at` y le pasan el rango a
la agregación. El ROAS calcula **dos** consolidados: uno histórico (del que sale la
Escala, siempre relativa a hoy) y otro del rango (filas + serie + semana).

## Consecuencias

- Una sola vara de fechas para toda la página: lo que se ve arriba y abajo cuadra.
- El default no cambia: quien no toca el filtro ve exactamente lo de antes (bajo riesgo).
- Costo IA y ROAS ahora leen `created_at` de los eventos (`events_log`, `voice_calls`)
  para poder acotarlos; sin rango el resultado es idéntico al anterior.
- La serie por día se **topa en 92 barras**: un rango más largo muestra los 92 días más
  recientes en el gráfico (los totales sí cubren todo el rango) y lo avisa.
- El agregado se sigue haciendo en JS (volumen v1 bajo, mismo criterio que el resto de
  Reportes); si crece, mover a vistas/RPC en Postgres.

## Alternativas consideradas

- **Rango solo en la sección nueva:** más simple, pero deja el resto de la página en
  histórico y no responde "¿cómo estuvo tal semana?". El dueño pidió todos los gráficos.
- **Que el rango arrastre también Hoy/7/30 y la proyección del mes:** rompe el
  significado de esas lecturas (una "proyección del mes" de un rango de 3 días no dice
  nada). Se dejaron ancladas a hoy y se explica en la UI.
- **Empujar los filtros a PostgREST en vez de filtrar en JS:** más eficiente, pero los
  totales del encabezado deben cubrir el filtro completo y varias secciones cruzan
  tablas (órdenes ↔ conversación ↔ agente); se mantuvo el patrón actual de barrer y
  agregar en JS por coherencia y menor riesgo.
