-- ---------------------------------------------------------------------------
-- 0004 — Debounce de respuestas (agrupar mensajes seguidos)
--
-- El webhook procesa con un debounce: al llegar un inbound se guarda y se marca
-- la conversación con el uuid del MENSAJE más reciente; una tarea en background
-- espera unos segundos y, si sigue siendo el último (nadie escribió después),
-- responde a TODOS los mensajes pendientes en una sola llamada. Si otro mensaje
-- llegó, esa tarea se apaga y responde la del último. Ver ADR-0013.
--
-- `last_inbound_message_uuid` es el "quién gana": el último en escribir.
-- ---------------------------------------------------------------------------
alter table conversations
  add column if not exists last_inbound_message_uuid text;
