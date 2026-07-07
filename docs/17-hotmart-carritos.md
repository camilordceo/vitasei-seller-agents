# 17 — Carritos Abandonados de Hotmart

## 1. Objetivo

Capturar los eventos de **carrito abandonado** de Hotmart y enviar automáticamente una
**plantilla de WhatsApp** al cliente para recuperar la venta. El flujo:

1. Hotmart detecta un carrito abandonado → dispara webhook a nuestra API.
2. Nuestro backend recibe el evento → extrae el teléfono del comprador.
3. Envía una plantilla de WhatsApp vía Callbell (único envío permitido fuera de 24h).
4. Crea/actualiza la conversación en Supabase para que el agente pueda continuar.

**Resultado:** el cliente recibe un mensaje de WhatsApp y, si responde, el agente de IA
toma la conversación normalmente.

---

## 2. Webhook de Hotmart

### URL del Endpoint
```
POST /api/webhooks/hotmart
```

**URL completa para configurar en Hotmart:**
```
https://<tu-dominio>.vercel.app/api/webhooks/hotmart?secret=<HOTMART_WEBHOOK_SECRET>
```

### Payload de Hotmart (evento `PURCHASE_OUT_OF_SHOPPING_CART`)

```json
{
  "id": "0d7aa966-b887-4617-8c56-9e865bfc8ce4",
  "creation_date": 1632411406874,
  "event": "PURCHASE_OUT_OF_SHOPPING_CART",
  "version": "2.0.0",
  "data": {
    "affiliate": true,
    "product": {
      "id": 3526906,
      "name": "Nombre del Producto"
    },
    "buyer": {
      "name": "Nombre del Comprador",
      "email": "comprador@email.com",
      "phone": "573001234567"
    },
    "offer": {
      "code": "n82b9jqz"
    },
    "checkout_country": {
      "name": "Colombia",
      "iso": "CO"
    },
    "buyer_ip": "190.25.xxx.xxx"
  }
}
```

**Campos clave:**
- `data.buyer.phone`: Teléfono del comprador (puede venir con o sin `+`)
- `data.buyer.name`: Nombre del comprador
- `data.buyer.email`: Email del comprador
- `data.product.name`: Nombre del producto que abandonaron
- `data.offer.code`: Código de la oferta (útil para tracking)

---

## 3. Flujo del Backend

```
Hotmart (carrito abandonado)
       │
       ▼
POST /api/webhooks/hotmart
       │
       ├─ 1) Validar secret (`HOTMART_WEBHOOK_SECRET`)
       ├─ 2) Filtrar: solo `PURCHASE_OUT_OF_SHOPPING_CART`
       ├─ 3) Extraer y normalizar teléfono (E.164 sin '+')
       ├─ 4) Idempotencia: ¿ya procesamos este evento? (por `hotmart_event_id`)
       │
       ├─ 5) Get-or-create Contact
       ├─ 6) Get-or-create Conversation (con `source: "hotmart"`)
       │
       ├─ 7) Guardar evento en `hotmart_events` (trazabilidad)
       │
       ├─ 8) Enviar plantilla de WhatsApp vía Callbell
       │     └─ `sendTemplate(phone, HOTMART_ABANDONED_CART_TEMPLATE_UUID)`
       │
       ├─ 9) Guardar mensaje outbound en `messages` (tag: `["hotmart-recovery"]`)
       └─ 10) Log en `events_log` (`hotmart_cart_abandoned`)
       │
       ▼
200 {"status":"ok"}
```

---

## 4. Variables de Entorno

| Variable | Descripción | Requerida |
|----------|-------------|-----------|
| `HOTMART_WEBHOOK_SECRET` | Secret para validar el webhook | Sí (prod) |
| `HOTMART_ABANDONED_CART_TEMPLATE_UUID` | UUID de la plantilla de WhatsApp en Callbell | Sí |
| `HOTMART_AGENT_ID` | ID del agente que maneja los carritos de Hotmart | Opcional* |

*Si no se especifica, usa el primer agente activo o el agente seed.

---

## 5. Plantilla de WhatsApp (Callbell)

La plantilla debe estar **aprobada** en Callbell/WhatsApp. Ejemplo de contenido:

> ¡Hola {{1}}! Vimos que dejaste tu carrito pendiente con {{2}}. ¿Tienes alguna duda?
> Estamos aquí para ayudarte a completar tu compra.

Variables:
- `{{1}}`: Nombre del comprador (`data.buyer.name`)
- `{{2}}`: Nombre del producto (`data.product.name`)

---

## 6. Tabla `hotmart_events` (trazabilidad)

Nueva tabla para registrar los eventos de Hotmart y evitar duplicados.

```sql
create table hotmart_events (
  id                  uuid primary key default gen_random_uuid(),
  hotmart_event_id    text unique not null,   -- id del payload de Hotmart
  event_type          text not null,          -- PURCHASE_OUT_OF_SHOPPING_CART
  phone               text not null,
  email               text,
  buyer_name          text,
  product_name        text,
  offer_code          text,
  conversation_id     uuid references conversations(id),
  message_sent        boolean not null default false,
  raw_payload         jsonb not null,
  created_at          timestamptz not null default now()
);
create index idx_hotmart_events_phone on hotmart_events(phone);
create index idx_hotmart_events_created on hotmart_events(created_at);
```

---

## 7. Comportamiento

### Si el cliente es NUEVO
1. Se crea `contact` con el teléfono y nombre.
2. Se crea `conversation` con `source = 'hotmart'` y el agente asignado.
3. Se envía la plantilla de WhatsApp.
4. Si el cliente responde → el agente de IA toma la conversación (flujo normal).

### Si el cliente YA EXISTE
1. Se busca la conversación activa más reciente.
2. Si NO hay conversación activa → se crea una nueva con `source = 'hotmart'`.
3. Se envía la plantilla de WhatsApp.
4. El agente de IA continúa la conversación.

### Idempotencia
- El `hotmart_event_id` (único) evita procesar el mismo evento dos veces.
- Si Hotmart reintenta el webhook, respondemos 200 pero no reenviamos.

---

## 8. Integración con el Agente

El mensaje de la plantilla se guarda en `messages` con:
- `direction: 'outbound'`
- `role: 'assistant'`
- `type: 'text'`
- `tags: ['hotmart-recovery']`

Cuando el cliente responde, el flujo normal del webhook de Callbell se activa:
1. El inbound llega a `/api/webhooks/callbell`.
2. Se asocia a la conversación existente.
3. El agente de IA responde con contexto del carrito abandonado.

**Nota para el prompt del agente:** se puede agregar una instrucción especial para
manejar clientes que vienen de carrito abandonado (si el último mensaje outbound
tiene tag `hotmart-recovery`).

---

## 9. Configuración en Hotmart

1. Ir a **Herramientas** > **Webhooks** en el panel de Hotmart.
2. Crear un nuevo webhook con:
   - **URL:** `https://<tu-dominio>.vercel.app/api/webhooks/hotmart?secret=<HOTMART_WEBHOOK_SECRET>`
   - **Evento:** `Abandono de carrito` / `PURCHASE_OUT_OF_SHOPPING_CART`
   - **Versión:** `2.0.0`
3. Guardar y activar.

---

## 10. Testing

```bash
# Simular un evento de carrito abandonado
curl -X POST https://localhost:3000/api/webhooks/hotmart?secret=test123 \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test-event-123",
    "event": "PURCHASE_OUT_OF_SHOPPING_CART",
    "version": "2.0.0",
    "data": {
      "buyer": {
        "name": "Juan Test",
        "email": "juan@test.com",
        "phone": "+573001234567"
      },
      "product": {
        "id": 123,
        "name": "Producto de Prueba"
      },
      "offer": { "code": "TEST123" }
    }
  }'
```

---

## 11. Métricas (Dashboard)

En el dashboard se puede agregar una sección de **Hotmart** con:
- Carritos abandonados recibidos (hoy / 7d / 30d)
- Mensajes enviados
- Conversiones (clientes que respondieron y compraron)
- Tasa de recuperación

---

## 12. Fuera de Alcance (v1)

- Enviar el link de checkout en la plantilla (requiere API de Hotmart)
- Seguimientos automáticos post-plantilla (usar el sistema de retargets existente)
- Integración de compras completadas de Hotmart
- Dashboard dedicado de Hotmart

---

## Referencias

- [Hotmart Cart Abandonment Webhook](https://developers.hotmart.com/docs/en/2.0.0/webhook/cart-abandonment-webhook/)
- [Hotmart Webhook Changelog](https://developers.hotmart.com/docs/en/changelog)
