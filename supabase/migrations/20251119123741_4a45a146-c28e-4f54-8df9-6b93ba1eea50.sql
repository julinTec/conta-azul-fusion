-- Create table for OAuth credentials per school
CREATE TABLE public.school_oauth_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid REFERENCES public.schools(id) ON DELETE CASCADE UNIQUE NOT NULL,
  client_id text NOT NULL,
  client_secret text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.school_oauth_credentials ENABLE ROW LEVEL SECURITY;

-- Only admins can manage OAuth credentials
CREATE POLICY "Admins can manage oauth credentials"
  ON public.school_oauth_credentials
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Trigger to update updated_at
CREATE TRIGGER handle_updated_at
  BEFORE UPDATE ON public.school_oauth_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();