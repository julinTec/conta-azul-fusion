-- Create sync_checkpoints table for resumable synchronization
CREATE TABLE public.sync_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  last_processed_index INTEGER DEFAULT 0,
  total_transactions INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(school_id)
);

-- Enable RLS
ALTER TABLE public.sync_checkpoints ENABLE ROW LEVEL SECURITY;

-- Only admins can manage sync checkpoints
CREATE POLICY "Admins can manage sync checkpoints"
ON public.sync_checkpoints FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));