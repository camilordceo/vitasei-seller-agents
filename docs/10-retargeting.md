# 10 — Retargeting (seguimientos automáticos)

Recupera clientes que reciben respuesta y dejan de responder, con **N seguimientos
por agente** (cuántos y a qué hora los define cada marca; sin config = backstop
genérico 1h/8h/23h). El mensaje es **dinámico** (lo genera la IA con el contexto de
la conversación), no un template fijo. Ver **ADR-0017** (feature) y **ADR-0052**
(config dinámica por agente).

## Flujo

```
Bot responde (no handoff, dentro de 24h)
        │
        ├─ scheduleRetargets → cancela vivos previos + inserta N filas en `retargets`
        │     etapas = agents.retarget_config (o backstop por env si vacío)
        │     cada fila: stage (ordinal por tiempo), delay_minutes, scheduled_at =
        │       now + delayMinutes,   anchor_inbound_at = last_inbound_at
        │
Cliente responde ──────────────► cancelScheduledRetargets (los `scheduled` → cancelled)
        │                          (la próxima respuesta del bot reagenda)
        ▼
Cron cada 5 min  (/api/cron/retargets)
        │
        ├─ toma `scheduled` vencidos con claim atómico (scheduled → processing)
        ├─ evaluateRetarget (guardas):
        │     · conversación activa           (si no → cancelled)
        │     · cliente NO respondió (anchor)  (si respondió → cancelled)
        │     · hay previous_response_id       (si no → cancelled)
        │     · dentro de ventana 24h          (si no → skipped)
        ├─ generateReply (1× Responses, encadenado con previous_response_id +
        │     instrucción interna de seguimiento que NO revela que es automático)
        ├─ parseReply → gate #ID → envía texto + imágenes por Callbell
        └─ marca `sent`, encadena previous_response_id, loguea `retarget_sent`
```

## Piezas

- **`lib/agent/retargetPlan.ts`** (puro, testeable): `parseRetargetConfig`,
  `planRetargets`, `evaluateRetarget`, `describeElapsed`, `buildRetargetInstruction`.
- **`lib/agent/retarget.ts`** (server): `scheduleRetargets`,
  `cancelScheduledRetargets`, `runDueRetargets` (worker) + generación y envío.
- **`app/api/cron/retargets/route.ts`**: endpoint del cron (auth por `CRON_SECRET`).
- **`vercel.json`**: `crons` → `/api/cron/retargets` cada 5 min.
- **`supabase/migrations/0006_retargets.sql`**: tabla `retargets` + enum
  `retarget_status` + índice único parcial de "vivos".
- **`supabase/migrations/0024_agent_retarget_config.sql`**: `agents.retarget_config`
  (jsonb) + `retargets.delay_minutes` + relaja el check de `stage` a `>= 1` (ADR-0052).
- Enganches en `lib/agent/processMessage.ts`: agenda al final de `generateAndSend`
  (no handoff), cancela en `ingestInboundMessage` (cliente respondió).

## Instrucción de seguimiento

Se pasa como el turno del usuario; el contexto real viaja por
`previous_response_id`. Resumen de lo que le pedimos al modelo:

- Retomar la conversación en **un solo** mensaje breve y natural.
- **No revelar** que es automático ni hablar de tiempos/recordatorios.
- No repetir el último mensaje; aportar algo nuevo (duda/objeción/beneficio).
- Respetar las reglas del prompt (no inventar precios/catálogo).
- Puede volver a mostrar un producto con su `#ID` exacto (gate anti-alucinación).
- No usar tags de flujo (es solo un seguimiento).

### Configurable por agente (ADR-0052)

En `/dashboard/retargets` → "Seguimientos por agente" cada marca define **cuántas**
etapas quiere y **a qué hora** (delay en horas tras dejar de responder), más la
**guía** (tono/estrategia) de cada una. Se guarda en el jsonb
`agents.retarget_config` = `[{ delayMinutes, guidance }]` (migración 0024). Sin
etapas = **backstop genérico** por env (1h/8h/23h). Guía vacía por etapa = guía por
defecto (`DEFAULT_RETARGET_GUIDANCE`).

- El orden de las etapas se calcula por **tiempo** (la más temprana es la etapa 1).
- El `delay_minutes` se guarda en cada fila de `retargets` para que el "hace cuánto"
  del mensaje (`describeElapsed`) y la etiqueta del dashboard sean exactos.
- ⚠️ **Ventana 24h:** una etapa a ~24h o más suele caer **fuera** de la ventana de
  24h de WhatsApp → se omite (`out-of-window`). Para recuperar más tarde, usa
  **Reactivaciones** por plantilla (7/15 días). La UI avisa a partir de ~23h.

Solo se edita el **cuándo** y la **guía**: el envoltorio de seguridad (encabezado
interno, "no reveles que es automático", "no inventes", "sin tags de flujo") lo pone
SIEMPRE el backend en `buildRetargetInstruction`, y el `system_prompt` del agente
sigue aplicando. La config se lee aparte y resiliente (`loadRetargetConfig`, no en
`AGENT_COLS`): si falta la migración 0024, se usa el backstop.

> Las columnas `retarget_instruction_1/2` (ADR-0043) quedan **deprecadas**: la
> migración 0024 las migra a `retarget_config` y el runtime ya no las lee.

## Config (env)

Los delays por etapa son el **backstop genérico**: se usan solo cuando el agente no
configuró sus propias etapas en el dashboard.

| Variable | Default | Qué hace |
|---|---|---|
| `RETARGET_ENABLED` | `true` | Kill switch global. `false`/`0` lo apaga. |
| `RETARGET_STAGE1_MS` | `3600000` (1h) | Delay de la 1ª etapa del backstop. |
| `RETARGET_STAGE2_MS` | `28800000` (8h) | Delay de la 2ª etapa del backstop. |
| `RETARGET_STAGE3_MS` | `82800000` (23h) | Delay de la 3ª etapa del backstop (near-24h). |
| `CRON_SECRET` | — | Protege el endpoint del cron (Vercel lo manda como `Bearer`). |

## Estados de `retargets`

`scheduled` → `processing` → `sent` | `skipped` | `cancelled` | `failed`.

- **skipped**: fuera de ventana 24h, sin config activa, o el modelo no produjo
  nada enviable (`empty-generation`).
- **cancelled**: cliente respondió / conversación no activa / reagendado.
- **failed**: error al procesar (queda `error` + log `retarget_error`).

## Eventos (`events_log`)

`retarget_sent`, `retarget_skipped`, `retarget_cancelled`, `retarget_error`,
`retarget_schedule_error` (+ `image_sent` con `retarget: true`).

## Notas de operación

- El cron requiere un plan de Vercel con ejecuciones frecuentes. Con 5 min de
  granularidad, un seguimiento puede dispararse hasta ~5 min tarde (irrelevante).
- Probar manualmente: `GET /api/cron/retargets?secret=<CRON_SECRET>` (o sin
  secret en dev). Devuelve `{ processed, sent, cancelled, skipped, failed }`.
- Reintentos de envíos `failed`: no hay (por ahora). Backlog.
