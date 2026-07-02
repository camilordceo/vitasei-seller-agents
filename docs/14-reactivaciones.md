# 14 — Reactivaciones por plantilla (7 y 15 días)

Feature de crecimiento: reengancha por WhatsApp a los clientes que escribieron y no compraron, con
**plantillas** aprobadas (único envío permitido fuera de la ventana de 24h) a un costo bajo
(≈ US$0,015 c/u). **Apagable desde el dashboard.** Ver **ADR-0021**.

## Cómo funciona
1. **Primer contacto:** cuando llega un cliente nuevo (se crea una conversación) y el feature está
   **encendido**, se agendan dos envíos: **día 7** y **día 15** (tabla `reactivations`).
2. **Cron:** el cron existente (`/api/cron/retargets`, cada 5 min) toma las vencidas y, si aplica,
   envía la plantilla por Callbell (`sendTemplate`).
3. **Cancelación:** si la persona **compra** (se crea una orden), se cancelan sus reactivaciones
   pendientes. Al enviar también se salta si: no hay plantilla configurada, el cliente escribió
   hace < 24h (está activo), o la reactivación venció hace > 3 días.
4. **Costo:** cada envío guarda `cost_usd` (US$0,015); el dashboard suma el total.

## Dashboard (Retargets → Reactivaciones)
- **Estado del feature:** interruptor ON/OFF. Apagado detiene programación y envíos.
- **UUID de plantilla · día 7 / día 15:** pega aquí el UUID de la plantilla de Callbell. Si un
  campo queda vacío, esa etapa no se envía.
- **Métricas:** programadas, enviadas, canceladas, saltadas/fallidas y **costo total** de plantillas.
- **Lista:** reactivaciones recientes con estado, etapa (Día 7 / Día 15) y costo; enlazan a la
  conversación.

## Configuración (una sola vez, al aprobar el feature)
1. En **Callbell**, crea la(s) plantilla(s) de WhatsApp y espera su **aprobación** por Meta.
2. Copia el **UUID** de cada plantilla y pégalo en el dashboard (día 7 y día 15; pueden ser la misma).
3. Asegúrate de que `CALLBELL_WHATSAPP_CHANNEL_UUID` esté configurado (canal de envío).
4. **Enciende** el interruptor. Haz una prueba real: la plantilla puede tener variables
   (`content.text`/`template_values`) — hoy se envía el nombre del contacto como texto; si tu
   plantilla usa otras variables, ajústalo antes de encender a producción.

## Delays (opcional, para pruebas)
Los delays por defecto son 7 y 15 días. Se pueden acortar con env (`REACTIVATION_STAGE1_MS`,
`REACTIVATION_STAGE2_MS`) para probar sin esperar días. El ON/OFF y los UUID **no** son env: van en
la DB (editables desde el dashboard sin re-deploy).

## Supabase
**Aplicar la migración `0008_reactivations.sql`** (crea `app_settings` + `reactivations`). Es el
único paso manual en Supabase. Reusa el enum `retarget_status` (0006).
