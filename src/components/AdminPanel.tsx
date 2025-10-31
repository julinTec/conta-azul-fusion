import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LogIn, RefreshCw, Database } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const CLIENT_ID = "2imfke8a0e9jc4v9qm01r1m9s1";
const REDIRECT_URI = `${window.location.origin}/auth/callback`;

export const AdminPanel = () => {
  const [syncing, setSyncing] = useState(false);
  const [hasConnection, setHasConnection] = useState(false);

  useState(() => {
    checkConnection();
  });

  const checkConnection = async () => {
    const { data } = await supabase
      .from('conta_azul_config')
      .select('id')
      .limit(1)
      .maybeSingle();
    
    setHasConnection(!!data);
  };

  const handleConnect = () => {
    const authUrl = new URL("https://auth.contaazul.com/oauth2/authorize");
    authUrl.searchParams.append("response_type", "code");
    authUrl.searchParams.append("client_id", CLIENT_ID);
    authUrl.searchParams.append("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.append("state", crypto.randomUUID());
    authUrl.searchParams.append("scope", "openid profile aws.cognito.signin.user.admin");

    const url = authUrl.toString();

    try {
      if (window.top && window.top !== window) {
        window.top.location.href = url;
        return;
      }
    } catch (_) {
      // Fallback
    }

    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      window.location.href = url;
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-conta-azul');

      if (error) throw error;

      toast.success(data.message || 'Sincronização concluída!');
      toast.info(`${data.count} transações sincronizadas`);
    } catch (error: any) {
      console.error('Error syncing:', error);
      toast.error(error.message || 'Erro ao sincronizar dados');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card className="mb-8 border-primary/20 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Painel Administrativo
        </CardTitle>
        <CardDescription>
          Configure a integração com Conta Azul e sincronize os dados
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasConnection ? (
          <div>
            <p className="text-sm text-muted-foreground mb-4">
              Conecte sua conta do Conta Azul para começar a sincronizar os dados financeiros.
            </p>
            <Button onClick={handleConnect} size="lg" className="w-full">
              <LogIn className="mr-2 h-5 w-5" />
              Conectar com Conta Azul
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-sm font-medium text-green-700 dark:text-green-300">
                  Conta Azul conectado
                </span>
              </div>
              <Button onClick={handleConnect} variant="outline" size="sm">
                Reconectar
              </Button>
            </div>

            <Button 
              onClick={handleSync} 
              disabled={syncing}
              size="lg" 
              className="w-full"
            >
              {syncing ? (
                <>
                  <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
                  Sincronizando...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-5 w-5" />
                  Sincronizar Dados
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Última sincronização: A sincronização busca os últimos 6 meses de dados
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
