-- Fase 1: Adicionar suporte ao Supabase Vault para tokens OAuth do Conta Azul

-- 1. Adicionar novas colunas para referenciar secrets do Vault
ALTER TABLE public.conta_azul_config 
  ADD COLUMN access_token_secret_id uuid,
  ADD COLUMN refresh_token_secret_id uuid;

-- 2. Tornar as colunas antigas opcionais (para permitir migração gradual)
ALTER TABLE public.conta_azul_config 
  ALTER COLUMN access_token DROP NOT NULL,
  ALTER COLUMN refresh_token DROP NOT NULL;

-- 3. Adicionar comentários para documentação
COMMENT ON COLUMN public.conta_azul_config.access_token_secret_id 
  IS 'Referência ao secret do Vault contendo o access_token criptografado';
COMMENT ON COLUMN public.conta_azul_config.refresh_token_secret_id 
  IS 'Referência ao secret do Vault contendo o refresh_token criptografado';

-- 4. Criar view segura para auditorias (opcional)
CREATE OR REPLACE VIEW public.conta_azul_config_safe AS
SELECT 
  id,
  expires_at,
  updated_by,
  created_at,
  updated_at,
  -- Apenas admins podem ver os secret_ids
  CASE WHEN has_role(auth.uid(), 'admin'::app_role) 
    THEN access_token_secret_id 
    ELSE NULL 
  END as access_token_secret_id,
  CASE WHEN has_role(auth.uid(), 'admin'::app_role) 
    THEN refresh_token_secret_id 
    ELSE NULL 
  END as refresh_token_secret_id
FROM public.conta_azul_config;