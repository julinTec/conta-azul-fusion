import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("Processando autenticação...");

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get("code");

      if (!code) {
        toast.error("Código de autorização não encontrado");
        navigate("/");
        return;
      }

      try {
        setStatus("Obtendo token de acesso...");
        const redirectUri = `${window.location.origin}/auth/callback`;
        
        const { data: tokenData, error } = await supabase.functions.invoke("conta-azul-auth", {
          body: {
            code,
            redirectUri,
          },
        });

        if (error) throw error;

        // Verificar se o usuário é admin
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Usuário não autenticado");

        const { data: roles } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .eq('role', 'admin')
          .maybeSingle();

        if (!roles) {
          toast.error("Apenas administradores podem conectar ao Conta Azul");
          navigate("/dashboard");
          return;
        }

        setStatus("Salvando tokens no Vault...");

        // Salvar tokens no Vault via edge function
        const { data: vaultIds, error: vaultError } = await supabase.functions.invoke(
          'save-conta-azul-tokens',
          {
            body: {
              access_token: tokenData.access_token,
              refresh_token: tokenData.refresh_token,
              expires_in: tokenData.expires_in,
            }
          }
        );

        if (vaultError) throw vaultError;

        setStatus("Salvando configuração...");

        // Salvar IDs dos secrets no config (tokens nunca ficam em texto plano)
        const { error: configError } = await supabase
          .from('conta_azul_config')
          .upsert({
            access_token_secret_id: vaultIds.access_token_id,
            refresh_token_secret_id: vaultIds.refresh_token_id,
            expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
            updated_by: user.id,
            // Limpar tokens antigos em texto plano (se existirem)
            access_token: null,
            refresh_token: null,
          });

        if (configError) throw configError;

        toast.success("Conectado ao Conta Azul com sucesso!");
        toast.info("Clique em 'Sincronizar Dados' para atualizar as transações");
        navigate("/dashboard");
      } catch (error: any) {
        console.error("Error during authentication:", error);
        toast.error(error.message || "Erro ao conectar com Conta Azul");
        navigate("/dashboard");
      }
    };

    handleCallback();
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <div className="text-center space-y-4">
        <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
        <p className="text-lg text-muted-foreground">{status}</p>
      </div>
    </div>
  );
}
