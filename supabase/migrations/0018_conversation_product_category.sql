-- ============================================================================
-- conversations.product_category — fuente/producto de la conversación
-- 0018_conversation_product_category.sql
-- Ver: docs/21-fuente-producto-y-analitica.md
-- ============================================================================
--
-- Categoriza la conversación por PRODUCTO (ej. "magnesio", "colageno"). Se
-- autodetecta cuando el mensaje del cliente o la respuesta del bot menciona una
-- palabra clave configurada (se reutiliza el catálogo de palabras de `videos`),
-- y se puede fijar/cambiar a mano desde el dashboard. Sirve para medir qué
-- productos convierten mejor.

alter table conversations add column if not exists product_category text;
create index if not exists idx_conversations_product_category on conversations(product_category);

comment on column conversations.product_category is
  'Producto/fuente de la conversación (ej. magnesio). Autodetectado por palabra clave o manual.';
