-- Tabela para registrar logs de sincronização
CREATE TABLE public.sync_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'running', -- running, completed, failed, timeout
  round_number INTEGER NOT NULL DEFAULT 1,
  transactions_fetched INTEGER DEFAULT 0,
  transactions_enriched INTEGER DEFAULT 0,
  categories_found INTEGER DEFAULT 0,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Índices para consultas rápidas
CREATE INDEX idx_sync_logs_school_id ON public.sync_logs(school_id);
CREATE INDEX idx_sync_logs_started_at ON public.sync_logs(started_at DESC);
CREATE INDEX idx_sync_logs_status ON public.sync_logs(status);

-- Enable RLS
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

-- Admins podem ver e gerenciar logs
CREATE POLICY "Admins can manage sync logs"
ON public.sync_logs
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Comentário
COMMENT ON TABLE public.sync_logs IS 'Logs de cada execução da sincronização automática do Conta Azul';