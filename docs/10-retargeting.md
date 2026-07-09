# 10 — Retargeting (seguimientos automáticos)

Recupera clientes que reciben respuesta y dejan de responder, con dos
seguimientos: ~1h y ~8h después. El mensaje es **dinámico** (lo genera la IA con
el contexto de la conversación), no un template fijo. Ver **ADR-0017**.

## Flujo

```
Bot responde (no handoff, dentro de 24h)
        │
        ├─ scheduleRetargets → cancela vivos previos + inserta 2 filas en `retargets`
        │     etapa 1: now + RETARGET_STAGE1_MS (1h)   anchor_inbound_at = last_inbound_at
        │     etapa 2: now + RETARGET_STAGE2_MS (8h)
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

- **`lib/agent/retargetPlan.ts`** (puro, testeable): `planRetargets`,
  `evaluateRetarget`, `buildRetargetInstruction`.
- **`lib/agent/retarget.ts`** (server): `scheduleRetargets`,
  `cancelScheduledRetargets`, `runDueRetargets` (worker) + generación y envío.
- **`app/api/cron/retargets/route.ts`**: endpoint del cron (auth por `CRON_SECRET`).
- **`vercel.json`**: `crons` → `/api/cron/retargets` cada 5 min.
- **`supabase/migrations/0006_retargets.sql`**: tabla `retargets` + enum
  `retarget_status` + índice único parcial de "vivos".
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

### Editable por agente (ADR-0043)

La **guía** (tono/estrategia) de cada etapa se edita **por agente** en
`/dashboard/retargets` → "Instrucciones de los seguimientos" (columnas
`agents.retarget_instruction_1` = 1h y `retarget_instruction_2` = 8h; migración
0021). Sirve para calibrar algo más **agresivo** (cerrar hoy, oferta) o más
**informativo** (dudas, beneficios) por marca. Vacío = guía por defecto
(`DEFAULT_RETARGET_GUIDANCE`).

Solo se edita **la guía**: el envoltorio de seguridad (encabezado interno, "no
reveles que es automático", "no inventes", "sin tags de flujo") lo pone SIEMPRE el
backend en `buildRetargetInstruction`, y el `system_prompt` del agente sigue
aplicando. Las columnas se leen aparte y resiliente (`loadRetargetInstructions`, no
en `AGENT_COLS`): si falta la migración, se usa la guía por defecto.

## Config (env)

| Variable | Default | Qué hace |
|---|---|---|
| `RETARGET_ENABLED` | `true` | Kill switch global. `false`/`0` lo apaga. |
| `RETARGET_STAGE1_MS` | `3600000` (1h) | Delay de la 1ª etapa. |
| `RETARGET_STAGE2_MS` | `28800000` (8h) | Delay de la 2ª etapa. |
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
