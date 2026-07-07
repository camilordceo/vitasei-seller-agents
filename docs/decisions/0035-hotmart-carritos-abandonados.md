# ADR 0035 — Integración de Carritos Abandonados de Hotmart

**Estado:** Aceptado
**Fecha:** 2026-07-07
**Contexto:** Recuperación de ventas desde Hotmart vía WhatsApp

---

## Contexto

Vitasei vende productos a través de Hotmart. Cuando un cliente abandona el carrito
(llega al checkout pero no completa la compra), Hotmart puede disparar un webhook
con los datos del cliente. Queremos capturar ese evento y enviar automáticamente
un mensaje de WhatsApp para recuperar la venta, integrándolo con el agente de IA
existente.

## Decisión

Crear un **webhook independiente** (`/api/webhooks/hotmart`) que:

1. Recibe el evento `PURCHASE_OUT_OF_SHOPPING_CART` de Hotmart.
2. Extrae el teléfono del comprador y lo normaliza a E.164.
3. Envía una **plantilla de WhatsApp** vía Callbell (obligatoria fuera de 24h).
4. Crea/actualiza la conversación en Supabase para que el agente pueda continuar.

### Arquitectura elegida

```
Hotmart → /api/webhooks/hotmart → lib/hotmart/processEvent.ts
                                        │
                                        ├─ sendTemplate (Callbell)
                                        ├─ create/update conversation
                                        └─ log en hotmart_events + events_log
```

### Alternativas consideradas

| Alternativa | Pros | Contras |
|-------------|------|---------|
| **A) Webhook dedicado (elegida)** | Separación de concerns, fácil de mantener | Un endpoint más |
| B) Reutilizar webhook de Callbell | Un solo punto de entrada | Mezcla lógicas muy distintas |
| C) Zapier/Make como middleware | Sin código | Dependencia externa, costo, latencia |

### Por qué plantilla y no mensaje libre

WhatsApp exige plantilla aprobada para mensajes **iniciados por el negocio** (el
cliente no nos escribió primero). Como el carrito abandonado es outbound puro, la
plantilla es obligatoria. Callbell maneja el envío con `sendTemplate`.

### Idempotencia

Hotmart puede reintentar webhooks. Se usa el `id` del payload como
`hotmart_event_id` (único) para evitar duplicados. Si ya existe, respondemos 200
pero no reenviamos.

### Asignación de agente

El evento de Hotmart no tiene canal de Callbell (es pre-conversación). Opciones:

1. **Variable de entorno `HOTMART_AGENT_ID`**: apunta al agente que maneja Hotmart.
2. **Primer agente activo**: fallback si no está configurado.
3. **Agente por producto**: futuro (mapear `product.id` de Hotmart a un agente).

v1 usa la opción 1 con fallback a 2.

---

## Consecuencias

### Positivas
- Recuperación automática de carritos abandonados sin intervención manual.
- El cliente que responde entra al flujo normal del agente de IA.
- Trazabilidad completa en `hotmart_events` y `events_log`.
- Métricas de conversión Hotmart → WhatsApp → Venta.

### Negativas
- Requiere plantilla aprobada en WhatsApp (proceso manual en Callbell/Meta).
- Costo por plantilla (~$0.015 USD por envío).
- Si el teléfono de Hotmart es inválido, el mensaje no llega.

### Riesgos
- **Spam:** si un cliente abandona muchos carritos, recibiría muchas plantillas.
  Mitigación: cooldown por teléfono (ej. máximo 1 plantilla cada 24h por cliente).
- **Teléfono sin WhatsApp:** el mensaje no llega. Callbell lo reporta como fallido.

---

## Implementación

1. **Migración** `0013_hotmart_events.sql`: tabla de trazabilidad.
2. **Endpoint** `app/api/webhooks/hotmart/route.ts`: recibe y procesa.
3. **Lib** `lib/hotmart/processEvent.ts`: lógica de negocio (pura donde se pueda).
4. **Lib** `lib/hotmart/types.ts`: tipos del payload de Hotmart.
5. **Env** `HOTMART_WEBHOOK_SECRET`, `HOTMART_ABANDONED_CART_TEMPLATE_UUID`, `HOTMART_AGENT_ID`.

---

## Referencias

- `docs/17-hotmart-carritos.md` (PRD completo)
- [Hotmart Cart Abandonment Webhook](https://developers.hotmart.com/docs/en/2.0.0/webhook/cart-abandonment-webhook/)
