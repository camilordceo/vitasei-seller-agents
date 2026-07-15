# ADR-0052: Retargets dinámicos por agente (N etapas, horario configurable, backstop)

- **Estado:** Aceptada
- **Fecha:** 2026-07-15
- **Sprint:** —

## Contexto

Los retargets (seguimientos automáticos, ADR-0017) eran **dos etapas fijas** con
delay **global** por env (`RETARGET_STAGE1_MS` ≈1h, `RETARGET_STAGE2_MS` ≈8h). Lo
único editable por agente era la **guía** (tono/estrategia) de cada etapa
(`retarget_instruction_1/2`, ADR-0043).

El negocio pidió: (1) un **tercer** seguimiento cerca de las **24h**; (2) que el
**horario** de cada etapa sea configurable **por agente** (una marca quiere a la 1h,
otra a las 2h); (3) que el **número** de etapas sea dinámico (algunas marcas quieren
2, otras 3); (4) un **backstop genérico** cuando el agente no configura nada.

Restricción dura de WhatsApp: los mensajes **libres** (no plantilla) solo se entregan
dentro de la **ventana de 24h** desde el último inbound del cliente. El gate
`isWithinWindow` ya omite (`out-of-window`) los retargets fuera de esa ventana. Como
el retarget se ancla al último inbound y se agenda desde la respuesta del bot, una
etapa a **exactamente 24h** cae fuera y **no se entrega**. Recuperar más tarde es
justamente lo que hacen las **Reactivaciones** por plantilla (7/15 días, ADR-0021).

## Decisión

1. **Config por agente en `jsonb`.** Nueva columna `agents.retarget_config` = array
   ordenable de etapas `[{ delayMinutes, guidance }]`. Soporta 0..N etapas (recortado
   a `MAX_RETARGET_STAGES = 5`). El ordinal `stage` se asigna por orden temporal. Se
   relaja el check de `retargets.stage` de `in (1,2)` a `>= 1`. Se guarda además
   `retargets.delay_minutes` en cada fila para que el "hace cuánto" del mensaje y la
   etiqueta del dashboard sean exactos e independientes del ordinal.
2. **Backstop genérico.** Sin config (null/vacío) se usan las etapas por env
   `RETARGET_STAGE1/2/3_MS` (default **1h / 8h / 23h**). Guía vacía por etapa →
   `DEFAULT_RETARGET_GUIDANCE`. La 3ª por defecto es **23h y no 24h** a propósito:
   entra en la ventana y sí se entrega.
3. **"Hace cuánto" derivado del delay.** `buildRetargetInstruction(delayMinutes, …)`
   calcula la frase ("hace alrededor de una hora" / "varias horas" / "casi un día")
   desde el delay real, no desde el ordinal.
4. **Editor dinámico en `/dashboard/retargets`.** Agregar/quitar etapas por agente
   (horas + guía), con **aviso** cuando una etapa ≥23h puede caer fuera de la ventana
   de 24h (sugiere Reactivaciones para más tarde).
5. **Resiliencia.** `retarget_config` se lee en consulta **aparte** (no en
   `AGENT_COLS`) y tolerante a `42703`: si la migración 0024 no está aplicada,
   `parseRetargetConfig` devuelve `[]` → se usa el backstop. La migración hace
   **backfill** de la guía existente (ADR-0043) a las etapas 1h/8h.

## Consecuencias

- Cada marca calibra su cadencia de seguimientos sin tocar env ni redeploy.
- El modelo de datos es a prueba de futuro (N etapas) sin columnas nuevas por etapa.
- Las columnas `retarget_instruction_1/2` quedan **deprecadas** (solo fuente del
  backfill); el runtime ya no las usa. No se eliminan (inmutabilidad de datos).
- El "24h" real como mensaje libre sigue **imposible** por diseño de WhatsApp; la UI
  lo hace explícito y el backstop usa 23h. Para 24h+ está Reactivaciones.
- Requiere aplicar la **migración 0024** en Supabase y (opcional) fijar
  `RETARGET_STAGE3_MS`. Ver `docs/10-retargeting.md`.

## Alternativas consideradas

- **Columnas discretas `delay_1/2/3 + instruction_1/2/3`.** Rígidas (fijan 3), no
  modelan "número dinámico" y multiplican columnas/migraciones. Descartada.
- **Medir la ventana desde la respuesta del bot, no desde el inbound.** Haría
  "entregable" un 24h ficticio, pero WhatsApp ancla la ventana al inbound del
  cliente: mentiríamos y el envío fallaría/​requiere plantilla. Descartada.
- **Delays acumulativos entre etapas.** Menos intuitivo para el operador ("¿a qué
  hora total?"); se mantienen delays absolutos desde la respuesta del bot.
