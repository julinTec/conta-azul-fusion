import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LogIn } from "lucide-react";

const CLIENT_ID = "2imfke8a0e9jc4v9qm01r1m9s1";
const REDIRECT_URI = `${window.location.origin}/auth/callback`;

export const ContaAzulAuth = () => {
  const handleConnect = () => {
    const authUrl = new URL("https://auth.contaazul.com/oauth2/authorize");
    authUrl.searchParams.append("response_type", "code");
    authUrl.searchParams.append("client_id", CLIENT_ID);
    authUrl.searchParams.append("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.append("state", crypto.randomUUID());
    authUrl.searchParams.append("scope", "openid profile aws.cognito.signin.user.admin");
    authUrl.searchParams.append("prompt", "login");
    authUrl.searchParams.append("max_age", "0");

    const url = authUrl.toString();

    // Prefer navigating the top window (outside the editor iframe)
    try {
      if (window.top && window.top !== window) {
        window.top.location.href = url;
        return;
      }
    } catch (_) {
      // Some sandboxed iframes may block access to window.top; fallback below
    }

    // Fallback: open in a new tab. If blocked by popup blockers, use same-tab
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      window.location.href = url;
    }
  };

  return (
    <Card className="max-w-md mx-auto mt-8">
      <CardHeader>
        <CardTitle>Conectar Conta Azul</CardTitle>
        <CardDescription>
          Conecte sua conta do Conta Azul para visualizar seus dados financeiros
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={handleConnect} className="w-full" size="lg">
          <LogIn className="mr-2 h-5 w-5" />
          Conectar com Conta Azul
        </Button>
      </CardContent>
    </Card>
  );
};
