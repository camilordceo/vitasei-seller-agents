# ADR-0077: Reportes multimercado — un total homologado (y dicho) + mapa de calor día × hora

- **Estado:** Aceptada
- **Fecha:** 2026-07-22
- **Sprint:** 6 (reportes)

## Contexto

Vitasei ya vende en tres mercados (Colombia, México, EE.UU.) y cada agente tiene su
moneda (ADR-0068). Órdenes y los cortes por producto ya homologaban sus montos, pero
**la página de Reportes no**: `summarizeOrders` recibía `total` a secas y sumaba peras
con manzanas. En pantalla se veía "Ventas confirmadas $1.156" donde adentro había una
orden de **USD 96 contada como 96 pesos** y órdenes mexicanas contadas como pesos
colombianos. El número no era "aproximado": era falso, y encima se copiaba al equipo
por WhatsApp con el botón de resumen.

El ROAS tenía el problema simétrico: al detectar más de una moneda en el alcance,
apagaba el consolidado, el gráfico de 14 días y toda la sección de escala (`total = null`).
Es decir, justo cuando la operación creció a varios países, el dueño se quedó **sin** la
foto consolidada.

Aparte, la analítica de horarios existía en dos cortes sueltos —por día de la semana y
por hora— que promedian la otra dimensión: un martes fuerte y un pico a las 8 p.m. no
dicen que el martes a las 8 p.m. sea el momento de empujar pauta.

## Decisión

1. **Ninguna suma toca un monto crudo.** `summarizeOrders` recibe la moneda nativa de
   cada orden y una moneda de **lectura**, y convierte ANTES de acumular (redondeo de
   presentación una sola vez, al final). La moneda nativa la manda el **agente** dueño de
   la conversación, no `orders.currency` (columna envenenada con `'COP'`, ADR-0068). Lo
   que no tiene tasa no se suma: se cuenta en `excluded` y se dice en pantalla.
2. **El total se declara.** El reporte expone `currency` / `converted` / `excluded`, y la
   UI muestra un aviso ARRIBA de los titulares — "Total de todos los mercados homologado a
   COP · 1 USD = 3.500 COP · 1 MXN = 175 COP" — que también viaja en el resumen que se
   comparte por WhatsApp. Un total convertido sin la tasa a la vista se lee como si fuera
   plata en caja.
3. **El ROAS consolida en vez de apagarse.** `summarizeRoas` toma una moneda de lectura:
   las FILAS siguen en la moneda de cada agente (ahí manda el costo por chat que el dueño
   configuró) y el consolidado, el gráfico de 14 días y la escala (economía por chat,
   proyección del mes, semana contra semana) se homologan. Un agente con una moneda sin
   tasa queda fuera del consolidado —con sus chats y todo, o el ROAS saldría torcido— y se
   reporta en `excludedAgents`.
4. **Mapa de calor "cuándo se vende" (día × hora).** Nueva matriz 7×24 (`byWeekdayHour`,
   hora Colombia) con las órdenes generadas, más el cálculo de las **tres mejores franjas
   de 3 horas** y cuánta plata concentran. Va abierto en la página; los cortes sueltos
   pasan a un desplegable.

## Consecuencias

- Los titulares, las ventanas de tiempo, los cortes por estado/método, los 14 días y el
  ROAS consolidado ahora cuadran entre sí y con Órdenes: todos leen la misma moneda con
  las mismas tasas fijas de `lib/dashboard/currency.ts`.
- Filtrar por un agente lee en la moneda de ESE agente (México en MXN, EE.UU. en USD) y
  el aviso desaparece: no hay conversión que declarar.
- Las tasas siguen siendo **fijas en código**, a propósito (lectura estable y
  reproducible). Cuando el negocio pida tasas reales, cambia el origen de `USD_RATES` y
  el resto no se entera.
- El mapa de calor es descriptivo, no causal: dice cuándo se cerró, no cuándo conviene
  pautar si nunca se ha pautado a esa hora. Con pocas órdenes, una celda oscura es una
  sola venta — por eso la lectura destacada es la franja de 3 h, no la hora suelta.
- Riesgo asumido: el consolidado multimercado es una **equivalencia**, no una caja. Se
  mitiga diciéndolo siempre que se convierte (aviso + resumen compartible).

## Alternativas consideradas

- **Dejar el total apagado cuando hay varias monedas** (lo que hacía el ROAS): honesto,
  pero deja al dueño sin la foto justo al internacionalizarse. Se prefirió consolidar y
  declarar la tasa.
- **Mostrar un total por mercado, sin consolidar**: útil, pero no responde "¿cuánto
  vendimos?". Queda cubierto por la tabla del ROAS, que sigue fila por fila en su moneda.
- **Tasas en vivo de un proveedor de FX**: dos personas mirando el mismo filtro verían
  números distintos según el minuto, y agrega un servicio externo (contra el principio de
  menos infraestructura). Se pospone a una tabla `fx_rates` con fecha.
- **Un heatmap por conversaciones en vez de por ventas**: dice cuándo escriben, no cuándo
  compran. El de ventas es el que decide presupuesto; el de chats queda como siguiente paso.
