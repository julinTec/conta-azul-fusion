-- Adicionar coluna de código para identificação das escolas
ALTER TABLE public.schools 
  ADD COLUMN IF NOT EXISTS code TEXT;

-- Popular com os códigos das escolas existentes
UPDATE public.schools 
SET code = 'CPF' 
WHERE slug = 'paulo-freire';

UPDATE public.schools 
SET code = 'CA' 
WHERE slug = 'aventurando';

-- Tornar obrigatório e único
ALTER TABLE public.schools 
  ALTER COLUMN code SET NOT NULL;

ALTER TABLE public.schools 
  ADD CONSTRAINT schools_code_unique UNIQUE (code);

-- Atribuir todas as 2.164 transações sem school_id ao Paulo Freire
UPDATE synced_transactions 
SET school_id = '065cbcfe-e2c4-424e-a993-5bd529f414af'
WHERE school_id IS NULL;