import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verificar se o usuário é admin
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('Não autenticado');
    }

    const { data: hasRole } = await supabaseClient.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin'
    });

    if (!hasRole) {
      throw new Error('Apenas administradores podem salvar tokens');
    }

    const { access_token, refresh_token, expires_in } = await req.json();

    if (!access_token || !refresh_token) {
      throw new Error('Tokens ausentes');
    }

    console.log('Saving tokens to conta_azul_config for user:', user.id);

    // Salvar tokens diretamente na tabela conta_azul_config
    const { error: configError } = await supabaseClient
      .from('conta_azul_config')
      .upsert({
        access_token: access_token,
        refresh_token: refresh_token,
        expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
        updated_by: user.id,
      });

    if (configError) throw new Error(`Failed to save tokens: ${configError.message}`);

    console.log('Tokens saved successfully to conta_azul_config');

    return new Response(
      JSON.stringify({ success: true }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );

  } catch (error) {
    console.error('Error in save-conta-azul-tokens:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );
  }
});