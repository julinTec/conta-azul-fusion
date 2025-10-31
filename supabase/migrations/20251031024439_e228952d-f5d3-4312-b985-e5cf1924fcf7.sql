-- Criar enum para roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Criar tabela de roles de usuários
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- Habilitar RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Função security definer para checar roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Políticas RLS para user_roles
CREATE POLICY "Users can view own roles"
ON public.user_roles
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles"
ON public.user_roles
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

-- Criar tabela para configurações do Conta Azul (apenas admin)
CREATE TABLE public.conta_azul_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_by UUID REFERENCES auth.users(id) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.conta_azul_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins can manage conta_azul_config"
ON public.conta_azul_config
FOR ALL
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Criar tabela de transações sincronizadas
CREATE TABLE public.synced_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount NUMERIC NOT NULL,
  description TEXT NOT NULL,
  transaction_date DATE NOT NULL,
  status TEXT,
  category_name TEXT,
  category_color TEXT,
  entity_name TEXT,
  raw_data JSONB,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (external_id)
);

ALTER TABLE public.synced_transactions ENABLE ROW LEVEL SECURITY;

-- Todos os usuários autenticados podem visualizar transações
CREATE POLICY "Authenticated users can view transactions"
ON public.synced_transactions
FOR SELECT
TO authenticated
USING (true);

-- Apenas admins podem inserir/atualizar/deletar transações (via sincronização)
CREATE POLICY "Only admins can modify transactions"
ON public.synced_transactions
FOR ALL
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Trigger para updated_at
CREATE TRIGGER update_conta_azul_config_updated_at
BEFORE UPDATE ON public.conta_azul_config
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Índices para performance
CREATE INDEX idx_synced_transactions_date ON public.synced_transactions(transaction_date DESC);
CREATE INDEX idx_synced_transactions_type ON public.synced_transactions(type);
CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);