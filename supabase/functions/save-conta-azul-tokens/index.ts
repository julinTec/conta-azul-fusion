import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to save token to Vault
async function saveTokenToVault(
  supabase: any, 
  tokenValue: string, 
  tokenName: string
): Promise<string> {
  const { data, error } = await supabase
    .from('vault.secrets')
    .insert({
      name: tokenName,
      secret: tokenValue,
      description: `Conta Azul ${tokenName} - managed by sync system`
    })
    .select('id')
    .single();
  
  if (error) throw new Error(`Failed to save token to vault: ${error.message}`);
  return data.id;
}

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

    console.log('Saving tokens to Vault for user:', user.id);

    // Verificar se já existem secrets para este sistema
    const { data: existingConfig } = await supabaseClient
      .from('conta_azul_config')
      .select('access_token_secret_id, refresh_token_secret_id')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let accessTokenId: string;
    let refreshTokenId: string;

    if (existingConfig?.access_token_secret_id && existingConfig?.refresh_token_secret_id) {
      // Atualizar secrets existentes
      console.log('Updating existing vault secrets');
      
      const { error: accessError } = await supabaseClient
        .from('vault.secrets')
        .update({ secret: access_token })
        .eq('id', existingConfig.access_token_secret_id);
      
      if (accessError) throw new Error(`Failed to update access token: ${accessError.message}`);

      const { error: refreshError } = await supabaseClient
        .from('vault.secrets')
        .update({ secret: refresh_token })
        .eq('id', existingConfig.refresh_token_secret_id);
      
      if (refreshError) throw new Error(`Failed to update refresh token: ${refreshError.message}`);
      
      accessTokenId = existingConfig.access_token_secret_id;
      refreshTokenId = existingConfig.refresh_token_secret_id;
    } else {
      // Criar novos secrets
      console.log('Creating new vault secrets');
      accessTokenId = await saveTokenToVault(
        supabaseClient, 
        access_token, 
        `conta_azul_access_token_${user.id}_${Date.now()}`
      );
      refreshTokenId = await saveTokenToVault(
        supabaseClient, 
        refresh_token, 
        `conta_azul_refresh_token_${user.id}_${Date.now()}`
      );
    }

    console.log('Tokens saved successfully to Vault');

    return new Response(
      JSON.stringify({
        access_token_id: accessTokenId,
        refresh_token_id: refreshTokenId,
      }),
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