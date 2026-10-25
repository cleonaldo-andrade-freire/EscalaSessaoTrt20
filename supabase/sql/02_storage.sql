-- =============================================================================
-- STORAGE — bucket público de fotos dos técnicos
-- Execute após o 01_schema.sql.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('fotos-membros', 'fotos-membros', TRUE)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "fotos_membros_leitura_publica" ON storage.objects;
DROP POLICY IF EXISTS "fotos_membros_upload_autenticado" ON storage.objects;
DROP POLICY IF EXISTS "fotos_membros_update_autenticado" ON storage.objects;
DROP POLICY IF EXISTS "fotos_membros_delete_autenticado" ON storage.objects;

CREATE POLICY "fotos_membros_leitura_publica"
ON storage.objects FOR SELECT
USING (bucket_id = 'fotos-membros');

CREATE POLICY "fotos_membros_upload_autenticado"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'fotos-membros');

CREATE POLICY "fotos_membros_update_autenticado"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'fotos-membros');

CREATE POLICY "fotos_membros_delete_autenticado"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'fotos-membros');
