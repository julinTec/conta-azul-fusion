-- Criar tabela de escolas
CREATE TABLE IF NOT EXISTS public.schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Habilitar RLS na tabela schools
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;

-- Política: Todos os usuários autenticados podem ver todas as escolas
CREATE POLICY "Authenticated users can view all schools"
  ON public.schools FOR SELECT
  TO authenticated
  USING (true);

-- Adicionar coluna school_id à tabela synced_transactions
ALTER TABLE public.synced_transactions 
  ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES public.schools(id);

-- Criar índice para performance
CREATE INDEX IF NOT EXISTS idx_synced_transactions_school_id 
  ON public.synced_transactions(school_id);

-- Atualizar política RLS de synced_transactions
DROP POLICY IF EXISTS "Authenticated users can view transactions" ON public.synced_transactions;

CREATE POLICY "Authenticated users can view all transactions"
  ON public.synced_transactions FOR SELECT
  TO authenticated
  USING (true);

-- Adicionar coluna school_id à tabela conta_azul_config
ALTER TABLE public.conta_azul_config 
  ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES public.schools(id);

-- Popular dados iniciais das escolas
INSERT INTO public.schools (name, slug, logo_url) 
VALUES 
  ('Colégio Paulo Freire', 'paulo-freire', '/assets/colegio-paulo-freire.png'),
  ('Colégio Aventurando', 'aventurando', '/assets/colegio-aventurando.png')
ON CONFLICT (slug) DO NOTHING;

-- Vincular transações existentes ao Colégio Paulo Freire
UPDATE public.synced_transactions 
SET school_id = (SELECT id FROM public.schools WHERE slug = 'paulo-freire')
WHERE school_id IS NULL;