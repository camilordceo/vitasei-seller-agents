# ADR 0036 — Etiquetas de Conversaciones

**Estado:** Aceptado
**Fecha:** 2026-07-08
**Contexto:** Clasificación y organización de conversaciones en el dashboard

---

## Contexto

Los operadores del dashboard necesitan clasificar y organizar las conversaciones para:
- Identificar rápidamente el estado de un prospecto ("no interesado", "sin presupuesto")
- Marcar acciones pendientes ("llamar después", "seguimiento")
- Priorizar clientes importantes ("VIP")

Actualmente no hay manera de etiquetar conversaciones más allá del estado (`active`/`handed_off`/
`closed`) y el método de pago.

## Decisión

Implementar un sistema de **etiquetas personalizables** (labels) que:

1. Se almacenan en una tabla `labels` (catálogo).
2. Se asocian a conversaciones via `conversation_labels` (N:M).
3. Se gestionan desde el detalle de conversación en el dashboard.
4. Tienen nombre y color (para badges visuales).

### Modelo elegido: Etiquetas libres con colores

```
labels (id, name, color, agent_id)
    ↓ 1:N
conversation_labels (conversation_id, label_id)
    ↑ N:1
conversations
```

### Alternativas consideradas

| Alternativa | Pros | Contras |
|-------------|------|---------|
| **A) Etiquetas libres (elegida)** | Flexible, el usuario crea las que necesita | Puede haber inconsistencia de nombres |
| B) Etiquetas fijas (enum) | Consistencia garantizada | Rígido, requiere deploy para agregar |
| C) Campo de texto libre | Máxima flexibilidad | Sin estructura, difícil de filtrar |
| D) Tags en JSON en conversations | Sin tabla extra | Difícil de indexar y consultar |

### Por qué etiquetas por agente

Cada agente (marca) puede tener etiquetas específicas. Una etiqueta con `agent_id = NULL` es
global (aparece para todas las conversaciones). Esto permite:
- Etiquetas compartidas ("No interesado" aplica a todos).
- Etiquetas específicas ("Interesado en Producto X" solo para Vitasei).

### Colores

Los colores facilitan el escaneo visual. Se ofrece una paleta predefinida pero el usuario
puede ingresar cualquier hex. El color se muestra como background del badge.

---

## Consecuencias

### Positivas
- Los operadores pueden organizar su pipeline de ventas.
- Contexto visual inmediato al abrir una conversación.
- Base para filtros y reportes futuros.
- Extensible: la IA podría sugerir etiquetas automáticamente.

### Negativas
- UI adicional en el detalle de conversación (más elementos).
- Posible proliferación de etiquetas similares ("No interesado" vs "no le interesa").

### Mitigaciones
- Seed con etiquetas predefinidas útiles.
- Validación de nombre único por agente.
- UI que prioriza seleccionar existentes sobre crear nuevas.

---

## Implementación

1. **Migración** `0014_labels.sql`: tablas `labels` y `conversation_labels` + seed.
2. **Tipos** en `lib/supabase/types.ts`.
3. **Queries** en `lib/dashboard/labels.ts`.
4. **Server Actions** en `app/dashboard/actions.ts`.
5. **Componentes** en `app/dashboard/conversations/[id]/`:
   - `LabelBadge.tsx`
   - `LabelSelector.tsx`
   - `CreateLabelModal.tsx`
   - `ConversationLabels.tsx`
6. **Integración** en `page.tsx` del detalle de conversación.

---

## Referencias

- `docs/18-etiquetas-conversaciones.md` (PRD completo)
