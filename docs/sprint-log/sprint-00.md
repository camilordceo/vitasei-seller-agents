# Sprint 00 — Setup del repo y servicios

- **Fecha / sesión:** 2026-06-28
- **Estado:** En progreso — bloqueado por aprovisionamiento externo

## Objetivo
Repo + servicios listos: GitHub, Vercel, Supabase (`seller-agent-vitasei`), OpenAI y
Callbell con sus API keys, y `.env` lleno a partir de `.env.example`.
**Aceptación:** `npm run dev` levanta; conexión a Supabase OK; ping a OpenAI y Callbell OK.

## Qué se hizo
- Scaffold mínimo para que `npm run dev` levante (parte compartida con el Sprint 1).
- `.env.local` creado a partir de `.env.example` (placeholders vacíos, gitignoreado).
- `GET /api/health`: verifica conectividad a Supabase, OpenAI y Callbell y reporta
  `ok`/`error` por servicio — es la herramienta para validar la aceptación de pings.
- Dependencias instaladas y build verde (ver Sprint 1).

## Criterio de aceptación
- [x] **`npm run dev` levanta** — verificado: dev server arriba en ~4s; `GET /` → 200,
  `GET /api/webhooks/callbell` → 200 `{"status":"ok"}`, `GET /api/health` responde JSON.
- [ ] **Conexión a Supabase OK** — pendiente: requiere crear el proyecto
  `seller-agent-vitasei` y pegar `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
  en `.env.local`. Validación: `GET /api/health` → `checks.supabase: "ok"`.
- [ ] **Ping a OpenAI OK** — pendiente: pegar `OPENAI_API_KEY`. Validación: `checks.openai: "ok"`.
- [ ] **Ping a Callbell OK** — pendiente: pegar `CALLBELL_API_KEY`. Validación: `checks.callbell: "ok"`.

> Sin credenciales, `/api/health` hoy devuelve `503 degraded` con cada check reportando la
> variable faltante (comportamiento esperado y verificado).

## Pasos manuales pendientes (requieren tus cuentas)
1. **GitHub:** crear repo `ai-seller-vitasei` y `git remote add origin ...` (no hay `gh`
   instalado en este entorno; puedo guiarte o usarlo si lo instalas y autenticas).
2. **Vercel:** conectar el repo (deploy del webhook necesita URL pública para Callbell).
3. **Supabase:** crear proyecto `seller-agent-vitasei`; aplicar
   `supabase/migrations/0001_init.sql` y `0002_storage_product_images.sql`.
4. **OpenAI:** crear API key.
5. **Callbell:** configurar WhatsApp, obtener API key y apuntar el webhook a
   `/api/webhooks/callbell`.
6. Llenar `.env.local` y correr `GET /api/health` → los 3 checks en `ok`.

## Desviaciones del PRD
- La aceptación de S0 (`npm run dev`) depende del scaffold que formalmente es del S1; se
  construyeron juntos (el usuario pidió S0+S1). Los pings dependen de credenciales que
  solo el usuario puede aprovisionar.

## Decisiones nuevas
- Ninguna específica de S0 (las decisiones técnicas están en los ADRs del S1).

## Pendientes / deuda técnica
- Cerrar la aceptación de pings cuando estén las credenciales.
- Confirmar un endpoint liviano y estable de Callbell para el health check
  (hoy usa `GET /v1/contacts?per_page=1`).

## Archivos principales
- `app/api/health/route.ts`, `.env.local`, `package.json`, configs del scaffold.
