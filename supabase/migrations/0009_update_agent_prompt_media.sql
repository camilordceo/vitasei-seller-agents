-- ---------------------------------------------------------------------------
-- 0009 — Amplía el system prompt activo: comprensión de imágenes y notas de voz
--
-- El agente ahora VE las imágenes y ESCUCHA las notas de voz del cliente (las
-- notas de voz se transcriben y entran como texto; las imágenes van como visión
-- en la misma llamada de Responses). Este bloque le dice CÓMO usarlas, con foco
-- en el caso estrella: la captura del comprobante de pago. Ver docs/15, ADR-0022.
--
-- Se APENDA al prompt activo (no lo reescribe) y sube `version` a 3. Idempotente:
-- solo apenda si el marcador aún no está presente.
-- ---------------------------------------------------------------------------
update agent_config
set
  system_prompt = system_prompt || E'\n\n' || $media$IMÁGENES Y NOTAS DE VOZ
- Puedes VER las imágenes que te manda el cliente y ESCUCHAR sus notas de voz (llegan transcritas).
- Comprobante o captura de PAGO/transferencia: agradece y confírmale que lo RECIBISTE y que el
  equipo que gestiona la entrega lo valida. TÚ NO confirmas el pago ni el cobro (eso es de
  logística). Si ya tienes método + ítems + datos de envío, cierra con #orden-lista.
- Foto o pantallazo de un producto: úsalo para entender qué quiere y responde con base en el
  catálogo (precios y specs SOLO del catálogo; si no está, dilo y ofrece verificar).
- Si la imagen no se ve con claridad o no la puedes interpretar, pídele con amabilidad que la
  reenvíe. NUNCA inventes lo que no puedas ver.$media$,
  version = 3
where name = 'vitasei-seller'
  and is_active = true
  and position('IMÁGENES Y NOTAS DE VOZ' in system_prompt) = 0;
