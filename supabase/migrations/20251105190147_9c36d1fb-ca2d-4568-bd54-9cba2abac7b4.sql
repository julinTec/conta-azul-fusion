-- Remove Vault secret ID columns and ensure token columns exist
ALTER TABLE public.conta_azul_config 
  DROP COLUMN IF EXISTS access_token_secret_id,
  DROP COLUMN IF EXISTS refresh_token_secret_id;

-- Ensure token columns exist as text (they should already exist)
-- access_token and refresh_token columns already exist in the table