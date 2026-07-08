-- ============================================================================
-- videos: caption opcional
-- 0017_videos_caption.sql
-- Ver: docs/20-videos-por-palabra.md, ADR-0038
-- ============================================================================
--
-- Texto opcional que acompaña al video (ej. "Mira acá los beneficios del
-- colágeno"). Callbell NO admite caption incrustado en video (`type: document`;
-- solo `image` lo soporta), así que el backend lo envía como un mensaje de TEXTO
-- justo antes del video. Si es NULL/vacío, solo se envía el video.

alter table videos add column if not exists caption text;

comment on column videos.caption is 'Texto opcional enviado (como mensaje aparte) junto con el video';
