-- Create DFC mapping table
CREATE TABLE IF NOT EXISTS public.dfc_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  descricao TEXT NOT NULL,
  categoria TEXT,
  nivel_1 TEXT NOT NULL,
  nivel_2 TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.dfc_mapping ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Authenticated users can view DFC mappings"
  ON public.dfc_mapping
  FOR SELECT
  USING (true);

CREATE POLICY "Only admins can manage DFC mappings"
  ON public.dfc_mapping
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Create index for fast lookup
CREATE INDEX idx_dfc_mapping_school_descricao ON public.dfc_mapping(school_id, descricao);

-- Create trigger for updated_at
CREATE TRIGGER update_dfc_mapping_updated_at
  BEFORE UPDATE ON public.dfc_mapping
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();