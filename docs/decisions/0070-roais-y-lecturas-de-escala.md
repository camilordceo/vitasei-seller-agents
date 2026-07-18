# ADR-0070: ROAIS (retorno sobre el gasto de IA) y lecturas de escala

- **Estado:** Aceptada
- **Fecha:** 2026-07-18
- **Sprint:** mejoras de dashboard

## Contexto

El cuadro de Retorno (ADR-0065) compara las ventas contra la pauta, pero el otro costo variable
del negocio —la IA (tokens, imágenes, audios, llamadas)— vivía en otra sección, en USD, sin
relación con los chats ni con las ventas. No se podía responder *¿cuánto me cuesta la IA por
conversación atendida?* ni *¿cuánto retorna cada dólar de IA?*. Además, al escalar aparecen
preguntas que ningún cuadro respondía: cuánto deja **un chat** después de pagar pauta e IA, a
dónde va el mes al ritmo actual, y si la operación crece o se frena semana a semana.

## Decisión

1. **Costo IA por agente.** El gasto de IA se atribuye por agente: tokens y audios salen de
   `events_log` vía la conversación del evento (mismo criterio que `getAiCostReport`; los
   eventos sin conversación no se atribuyen), y las llamadas de `voice_calls`, que ya llevan
   `agent_id`. Se calcula en `getRoasReport` con un solo scan (sin N+1 por agente).
2. **En la tabla del ROAS, dos columnas:** **Costo IA/chat** (gasto IA ÷ chats, convertido de
   USD a la moneda del agente con las tasas fijas de ADR-0068) y **ROAIS** (return on AI
   spend = ventas generadas ÷ gasto IA). Sin gasto IA el ROAIS es `null` (no se inventa un
   retorno infinito), igual que la regla de ADR-0065 para la pauta.
   **No incluye** la tarifa de plantillas/conversaciones de Meta: no se registra aún; el día
   que se registre, entra al mismo mapa de costos por agente sin tocar la UI.
3. **Sección "Escala"** derivada de los MISMOS hechos del ROAS (para que los números cuadren):
   - **Margen por chat** = (ventas − pauta − IA) ÷ chats. Es el margen *antes* de producto y
     logística, y así se enuncia.
   - **Proyección del mes** = MTD ÷ días corridos × días del mes (calendario Bogota), con el
     mes anterior completo como vara. Run-rate simple a propósito: sin estacionalidad ni
     regresión; se presenta como "a este ritmo", no como forecast.
   - **Crecimiento semanal** = últimos 7 días vs. los 7 anteriores, en chats (siempre) y en
     ventas (solo con moneda única).
   Con monedas mezcladas en el alcance, la plata no se consolida (regla de ADR-0065/0068) pero
   el crecimiento de chats sí se muestra.
4. **El gráfico de inversión vs. ventas muestra los montos**: cada barra lleva su valor al
   lado, la fila entera lleva tooltip (`title`) con el detalle del día, y la leyenda muestra el
   total de los 14 días. Un gráfico de plata sin números obligaba a adivinar magnitudes.

## Consecuencias

- ROAS (pauta) y ROAIS (IA) quedan lado a lado en las mismas unidades: se ve qué costo domina
  y cuál está apalancando las ventas. Hoy el ROAIS será enorme (la IA cuesta centavos frente a
  la pauta) — eso también es el mensaje: el costo marginal de atender un chat con IA es ínfimo.
- La proyección del mes es sensible al inicio del mes (con 2 días corridos, un día bueno la
  infla). Se acepta: muestra los datos con los que se calculó (van $X en N de M días) para que
  se lea con ese contexto.
- El costo IA histórico usa los precios actuales de `lib/openai/pricing.ts` (misma limitación
  que el reporte de Costo IA): si cambia el precio del modelo, el pasado se recalcula.

## Alternativas consideradas

- **ROAIS sobre pauta + IA combinadas (un solo "ROI de adquisición").** Menos columnas, pero
  mezcla dos palancas que se gestionan por separado (negociar CPL vs. optimizar el agente). El
  margen por chat de la sección Escala ya da la lectura combinada.
- **Forecast con regresión/estacionalidad.** Sobra a este volumen: con pocas semanas de
  historia, un run-rate honesto y enunciado como tal es más útil que una curva con aire de
  precisión.
- **Traer el costo de plantillas de Meta.** Requiere registrar el pricing de conversaciones de
  WhatsApp (categoría, país) que hoy no llega por webhook; queda como siguiente paso del mismo
  mapa de costos.
