-- Remover configuração órfã do Conta Azul com tokens nulos
-- Isso permite que o botão "Conectar com Conta Azul" apareça novamente
DELETE FROM conta_azul_config 
WHERE access_token_secret_id IS NULL 
  AND refresh_token_secret_id IS NULL;