-- Remove view não utilizada que está gerando alerta de segurança
-- A tabela base conta_azul_config já tem RLS adequado (apenas admins)
DROP VIEW IF EXISTS public.conta_azul_config_safe;