-- =============================================================================
-- PRIMEIRO ADMINISTRADOR
--
-- O cadastro de técnicos pelo app exige um admin logado. Para o primeiro acesso:
--   1. Supabase Studio > Authentication > Users > "Add user" (marque
--      "Auto Confirm User") com o e-mail e a senha do administrador.
--   2. Troque o nome e o e-mail abaixo e execute este script no SQL Editor.
-- =============================================================================

INSERT INTO public.membros (id, nome, email, is_admin, ativo)
SELECT u.id, 'Nome do Administrador', u.email, TRUE, TRUE
FROM auth.users u
WHERE u.email = 'admin@trt20.jus.br'
ON CONFLICT (id) DO UPDATE SET is_admin = TRUE, ativo = TRUE;

-- Conferência
SELECT id, nome, email, is_admin FROM public.membros WHERE is_admin = TRUE;
