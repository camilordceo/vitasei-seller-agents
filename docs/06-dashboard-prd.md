# 06 — Dashboard

Next.js (App Router) + Supabase Auth. Interno, para ver conversaciones y órdenes.
Styling: neutral/limpio + reglas UI "Pro Max" (contraste 4.5:1, touch targets 44px, focus rings,
loading/skeletons, mobile-first). **Sin marca Rentmies.** Dejar tokens de Vitasei como placeholder
hasta tenerlos.

## Vistas v1

### 1. Conversaciones (lista)
- Columnas: contacto (nombre/teléfono), último mensaje, estado (`active`/`handed_off`/`closed`), método (`addi`/`cod`/`undecided`), última actividad.
- Filtros: estado, método, búsqueda por teléfono/nombre.
- Realtime: actualizar con Supabase Realtime sobre `messages`/`conversations`.

### 2. Detalle de conversación
- Hilo de mensajes (cliente vs agente), con tipo (texto/imagen) y miniatura de imágenes.
- Panel lateral: datos del contacto, tags emitidos, productos mostrados (#ID), estado de orden.
- Acciones: cerrar conversación, marcar handoff manual.

### 3. Órdenes
- Lista de `orders` con estado, método, ítems, datos de envío.
- Filtro por estado (`pending_handoff`, `handed_off`, ...). Esta es la cola que toma logística.

### 4. Productos / catálogo
- Tabla de `products` (sku/#ID, nombre, precio, stock, imagen, estado de sync).
- Subida/actualización de catálogo (dispara el pipeline del doc 05).

### 5. Métricas (panel simple)
- Conversaciones por estado, órdenes por método, conversión, #ID más mostrados, tiempo a handoff.

## Auth
- Supabase Auth (email/clave o SSO de Vitasei). RLS de lectura para autenticados; escrituras puntuales (productos, cerrar conversación).
