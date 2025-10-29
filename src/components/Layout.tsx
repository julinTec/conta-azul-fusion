import { useEffect, useState, ReactNode } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { LogOut, LayoutDashboard, List } from "lucide-react";
import { ContaAzulAuth } from "@/components/ContaAzulAuth";
import { toast } from "sonner";

interface LayoutProps {
  children: ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasContaAzulToken, setHasContaAzulToken] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        checkContaAzulToken();
      } else {
        navigate("/auth");
      }
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        checkContaAzulToken();
      } else {
        navigate("/auth");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const checkContaAzulToken = () => {
    const token = localStorage.getItem("conta_azul_access_token");
    setHasContaAzulToken(!!token);
  };

  const handleDisconnect = () => {
    localStorage.removeItem("conta_azul_access_token");
    localStorage.removeItem("conta_azul_refresh_token");
    localStorage.removeItem("conta_azul_token_expires_at");
    setHasContaAzulToken(false);
    toast.success("Desconectado do Conta Azul");
    navigate("/");
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Logout realizado com sucesso");
    navigate("/auth");
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            FinanceFlow
          </h1>
          <div className="flex items-center gap-4">
            {hasContaAzulToken && (
              <nav className="flex items-center gap-2">
                <Link to="/dashboard">
                  <Button 
                    variant={location.pathname === "/dashboard" ? "default" : "ghost"} 
                    size="sm"
                  >
                    <LayoutDashboard className="h-4 w-4 mr-2" />
                    Dashboard
                  </Button>
                </Link>
                <Link to="/transactions">
                  <Button 
                    variant={location.pathname === "/transactions" ? "default" : "ghost"} 
                    size="sm"
                  >
                    <List className="h-4 w-4 mr-2" />
                    Lançamentos
                  </Button>
                </Link>
              </nav>
            )}
            <span className="text-sm text-muted-foreground">{user?.email}</span>
            {hasContaAzulToken && (
              <Button onClick={handleDisconnect} variant="outline" size="sm">
                Desconectar
              </Button>
            )}
            <Button onClick={handleSignOut} variant="outline" size="sm">
              <LogOut className="h-4 w-4 mr-2" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {!hasContaAzulToken ? (
          <ContaAzulAuth />
        ) : (
          children
        )}
      </main>
    </div>
  );
};
