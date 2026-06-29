-- ============================================================================
-- AI Seller Vitasei — Storage: bucket de imágenes de producto
-- 0002_storage_product_images.sql  (Sprint 1)
-- Las imágenes se suben aquí en el Sprint 2; products.image_url apunta a su URL.
-- ============================================================================

-- Bucket público para imágenes de producto.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- Lectura pública del bucket (idempotente).
drop policy if exists "public read product-images" on storage.objects;
create policy "public read product-images"
  on storage.objects for select
  using (bucket_id = 'product-images');

-- Escrituras al bucket: las hace el backend con SERVICE ROLE (bypassa RLS).
-- El modelo de escritura desde el dashboard se afina con el auth de Vitasei (S6).
