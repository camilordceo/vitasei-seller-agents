# 18 — Etiquetas de Conversaciones

## 1. Objetivo

Permitir a los operadores del dashboard **etiquetar conversaciones** con labels personalizados
para clasificarlas y organizarlas mejor. Ejemplos de etiquetas:

- "No interesado"
- "No tiene plata"
- "Llamar en un rato"
- "Cliente VIP"
- "Seguimiento pendiente"

**Resultado:** mejor organización del pipeline de ventas, filtrado rápido y contexto visual
al abrir una conversación.

Las etiquetas se muestran como **chips de color en la lista de conversaciones** (Resumen y
`/dashboard/conversations`), para identificar cada conversación de un vistazo sin tener que abrirla.
Se cargan en `getRecentConversations` (embed de `labels`, resiliente si falta la migración 0014) y
se renderizan en `ConversationList` (`app/dashboard/ui.tsx`).

---

## 2. Modelo de Datos

### Tabla `labels` (catálogo de etiquetas)

```sql
create table labels (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,              -- "No interesado", "VIP", etc.
  color       text not null default '#6B7280',  -- hex color para el badge
  agent_id    uuid references agents(id), -- NULL = global, con ID = solo ese agente
  created_at  timestamptz not null default now(),
  unique (name, agent_id)                 -- no duplicar nombre por agente
);
```

### Tabla `conversation_labels` (relación N:M)

```sql
create table conversation_labels (
  conversation_id  uuid not null references conversations(id) on delete cascade,
  label_id         uuid not null references labels(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (conversation_id, label_id)
);
```

---

## 3. Flujo de Usuario

### En el detalle de conversación (`/dashboard/conversations/[id]`)

1. **Ver etiquetas actuales**: badges de colores debajo del nombre del contacto.
2. **Agregar etiqueta**: dropdown con las etiquetas existentes + opción "Crear nueva".
3. **Quitar etiqueta**: click en la X del badge.
4. **Crear etiqueta nueva**: modal con nombre y selector de color.

### En la lista de conversaciones

1. **Ver etiquetas**: badges pequeños junto a cada conversación.
2. **Filtrar por etiqueta** (futuro): dropdown para ver solo conversaciones con X etiqueta.

---

## 4. Colores Predefinidos

Para facilitar la creación, ofrecemos una paleta de colores:

| Nombre | Hex | Uso sugerido |
|--------|-----|--------------|
| Gris | `#6B7280` | Default / Neutral |
| Rojo | `#EF4444` | No interesado / Problema |
| Amarillo | `#F59E0B` | Pendiente / Seguimiento |
| Verde | `#10B981` | Positivo / VIP |
| Azul | `#3B82F6` | Info / Llamar |
| Morado | `#8B5CF6` | Especial |
| Rosa | `#EC4899` | Otro |

---

## 5. API / Server Actions

### `getLabels(agentId?: string)`
Obtiene todas las etiquetas (globales + del agente si se pasa).

### `getConversationLabels(conversationId: string)`
Obtiene las etiquetas de una conversación específica.

### `createLabel({ name, color, agentId? })`
Crea una etiqueta nueva. Valida nombre único por agente.

### `addLabelToConversation(conversationId, labelId)`
Asocia una etiqueta a una conversación. Idempotente.

### `removeLabelFromConversation(conversationId, labelId)`
Quita una etiqueta de una conversación.

### `deleteLabel(labelId)`
Elimina una etiqueta (cascade quita las asociaciones).

### `updateLabel(labelId, { name?, color? })`
Edita nombre/color de una etiqueta.

---

## 6. Componentes UI

### `LabelBadge`
Badge con el color y nombre de la etiqueta. Con X para quitar si `onRemove` está definido.

```tsx
<LabelBadge label={label} onRemove={() => handleRemove(label.id)} />
```

### `LabelSelector`
Dropdown para seleccionar etiquetas existentes o crear una nueva.

```tsx
<LabelSelector
  conversationId={id}
  currentLabels={labels}
  availableLabels={allLabels}
  onAdd={handleAdd}
  onCreate={handleCreate}
/>
```

### `CreateLabelModal`
Modal para crear una etiqueta nueva con nombre y color.

```tsx
<CreateLabelModal
  open={isOpen}
  onClose={() => setOpen(false)}
  onCreate={handleCreate}
/>
```

### `ConversationLabels`
Componente que agrupa todo: muestra badges + selector.

```tsx
<ConversationLabels conversationId={id} agentId={agentId} />
```

---

## 7. Ubicación en el Dashboard

En `/dashboard/conversations/[id]/page.tsx`, debajo del nombre del contacto:

```
┌─────────────────────────────────────────┐
│  ← Volver                               │
│                                         │
│  Juan Pérez          [Pasar a manual]   │
│  +573001234567                          │
│                                         │
│  [No interesado] [Llamar] [+ Etiqueta]  │  ← NUEVO
│                                         │
│  ─────────────────────────────────────  │
│  Chat...                                │
└─────────────────────────────────────────┘
```

---

## 8. Etiquetas por Defecto (Seed)

Al aplicar la migración, se crean etiquetas globales útiles:

| Nombre | Color | Descripción |
|--------|-------|-------------|
| No interesado | Rojo | Cliente no quiere comprar |
| Sin presupuesto | Amarillo | Quiere pero no puede ahora |
| Llamar después | Azul | Solicita contacto telefónico |
| Cliente VIP | Verde | Cliente importante |
| Seguimiento | Amarillo | Requiere seguimiento manual |

---

## 9. Consideraciones

### Permisos
- Cualquier usuario autenticado del dashboard puede crear/editar etiquetas.
- Las etiquetas con `agent_id` solo aparecen para conversaciones de ese agente.
- Las etiquetas globales (`agent_id = NULL`) aparecen para todas.

### Performance
- Las etiquetas se cargan junto con la conversación (join).
- El selector carga todas las etiquetas disponibles (pocas, < 50).

### Extensiones futuras
- Filtrar lista de conversaciones por etiqueta.
- Etiquetas automáticas por IA (detectar "no me interesa" → sugerir etiqueta).
- Reportes por etiqueta (% de "No interesado", etc.).

---

## 10. Archivos a Crear/Modificar

### Nuevos
- `supabase/migrations/0014_labels.sql`
- `lib/dashboard/labels.ts` (queries y actions)
- `app/dashboard/conversations/[id]/ConversationLabels.tsx`
- `app/dashboard/conversations/[id]/LabelBadge.tsx`
- `app/dashboard/conversations/[id]/LabelSelector.tsx`
- `app/dashboard/conversations/[id]/CreateLabelModal.tsx`

### Modificados
- `lib/supabase/types.ts` (nuevos tipos)
- `lib/dashboard/queries.ts` (incluir labels en getConversation)
- `app/dashboard/conversations/[id]/page.tsx` (agregar componente)
- `app/dashboard/actions.ts` (server actions)
- `CHANGELOG.md`

---

## 11. Testing

```bash
# Crear etiqueta
curl -X POST /api/test/labels -d '{"name":"VIP","color":"#10B981"}'

# Agregar a conversación
curl -X POST /api/test/conversation-labels -d '{"conversationId":"...","labelId":"..."}'
```

En el dashboard:
1. Abrir una conversación
2. Click en "+ Etiqueta"
3. Seleccionar una existente o crear nueva
4. Verificar que aparece el badge
5. Click en X para quitar
6. Verificar que se quitó
