# AI Seller Vitasei

Agente de IA que vende productos del ecommerce de Vitasei por WhatsApp (Callbell),
usando OpenAI Responses API + File Search, con sistema `#ID` para imágenes desde Supabase,
flujos de compra (Addi / contra entrega) y handoff al equipo de logística. Incluye dashboard.

- **Supabase:** `seller-agent-vitasei`
- **Stack:** Next.js 14 · TypeScript · Supabase · Vercel · Inngest · OpenAI · Callbell

## Documentación (leer en orden)
1. `docs/00-master-prd.md` — visión, alcance, decisiones
2. `docs/01-arquitectura.md` — flujo y loop
3. `docs/02-supabase-schema.md` — schema (migración en `supabase/migrations/0001_init.sql`)
4. `docs/03-agente-prompt-y-tags.md` — system prompt + tags
5. `docs/04-integracion-callbell.md`
6. `docs/05-integracion-openai-filesearch.md`
7. `docs/06-dashboard-prd.md`
8. `docs/07-sprints.md` — **plan de ejecución para Claude Code**

## Setup rápido
```bash
cp .env.example .env   # llenar valores
npm install            # (Claude Code arma package.json en Sprint 1)
npm run dev
```
Aplicar schema:
```bash
supabase link --project-ref <ref-de-seller-agent-vitasei>
supabase db push
```

## Crear el repo en GitHub y subir
Con GitHub CLI (recomendado — Claude Code puede hacerlo):
```bash
gh repo create ai-seller-vitasei --private --source=. --remote=origin
git add -A && git commit -m "chore: scaffold + PRDs"   # si no está commiteado
git push -u origin main
```
O manual: crear el repo vacío en github.com y luego:
```bash
git remote add origin git@github.com:<usuario>/ai-seller-vitasei.git
git branch -M main
git push -u origin main
```

## Cómo trabaja Claude Code aquí
Seguir `docs/07-sprints.md` en orden. Respetar `CLAUDE.md`. Cada sprint tiene criterio de
aceptación; no avanzar al siguiente sin cumplirlo.
