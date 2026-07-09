-- ============================================================================
-- Plantillas de reactivación CON imagen (header) por agente
-- 0022_agent_reactivation_images.sql
-- Ver: docs/14-reactivaciones.md, ADR-0044
-- ============================================================================
--
-- Las plantillas de reactivación (7/15 días) hasta ahora se enviaban SIEMPRE como
-- `type:"text"` (solo texto). Callbell permite plantillas con un adjunto de imagen
-- (header), donde el archivo se elige al momento del envío. Esto agrega un link de
-- imagen OPCIONAL por etapa: si está puesto, el envío va como `type:"image"` con la
-- imagen en `content.url` y la variable del cuerpo en `template_values`; si queda
-- vacío, se sigue enviando como plantilla de solo texto (comportamiento actual).
--
-- NULL = plantilla de solo texto. Se leen APARTE y resiliente (loadReactivationImages,
-- NO en AGENT_COLS) para no arriesgar la ruta crítica de inbound si falta la migración.
--
-- Idempotente: seguro de correr más de una vez.

alter table agents
  add column if not exists reactivation_image_7d   text,
  add column if not exists reactivation_image_15d  text;

comment on column agents.reactivation_image_7d is
  'URL del header de imagen de la plantilla de reactivación día 7 (NULL = plantilla de solo texto). Ver ADR-0044';
comment on column agents.reactivation_image_15d is
  'URL del header de imagen de la plantilla de reactivación día 15 (NULL = plantilla de solo texto). Ver ADR-0044';
