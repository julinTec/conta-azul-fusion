import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const REDIRECT_URI = `${window.location.origin}/auth/callback`;

export default function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("Processando autenticação...");

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");

        if (!code) {
          throw new Error("Código de autorização não encontrado");
        }

        setStatus("Obtendo token de acesso...");

        // Exchange code for access token
        const { data, error } = await supabase.functions.invoke("conta-azul-auth", {
          body: { code, redirectUri: REDIRECT_URI },
        });

        if (error) throw error;

        // Store tokens in localStorage
        localStorage.setItem("conta_azul_access_token", data.access_token);
        localStorage.setItem("conta_azul_refresh_token", data.refresh_token);
        localStorage.setItem("conta_azul_token_expires_at", 
          String(Date.now() + data.expires_in * 1000)
        );

        toast.success("Conectado ao Conta Azul com sucesso!");
        navigate("/");
      } catch (error: any) {
        console.error("Error in auth callback:", error);
        toast.error("Erro ao conectar com Conta Azul: " + error.message);
        navigate("/");
      }
    };

    handleCallback();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <div className="text-center space-y-4">
        <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
        <p className="text-lg text-muted-foreground">{status}</p>
      </div>
    </div>
  );
}
