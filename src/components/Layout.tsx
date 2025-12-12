import { useEffect, useState, ReactNode } from "react";
import { useNavigate, Link, useLocation, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { LogOut, LayoutDashboard, List, Users, School, Clock, FileBarChart, Activity } from "lucide-react";
import { toast } from "sonner";
import { useUserRole } from "@/hooks/useUserRole";
import { useSchool } from "@/contexts/SchoolContext";

interface LayoutProps {
  children: ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { schoolSlug } = useParams();
  const { school, loading: schoolLoading } = useSchool();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { isAdmin, loading: roleLoading } = useUserRole();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
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
      } else {
        navigate("/auth");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  // Redundant protection: redirect non-admins from /admin/* routes
  useEffect(() => {
    if (!loading && !roleLoading && !isAdmin && location.pathname.includes('/admin/integrations')) {
      navigate('/schools', { replace: true });
      toast.error("Você não tem permissão para acessar esta página");
    }
  }, [location.pathname, isAdmin, loading, roleLoading, navigate]);

  // Redirect to schools if school not found
  useEffect(() => {
    if (!schoolLoading && schoolSlug && !school) {
      navigate('/schools', { replace: true });
      toast.error("Escola não encontrada");
    }
  }, [school, schoolLoading, schoolSlug, navigate]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Logout realizado com sucesso");
    navigate("/auth");
  };

  if (loading || roleLoading || schoolLoading) {
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
          <div className="flex items-center gap-8">
            <div className="flex flex-col">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                FinanceFlow
              </h1>
              {school && (
                <span className="text-sm text-muted-foreground">{school.name}</span>
              )}
            </div>
            <Button 
              onClick={() => navigate("/schools")} 
              variant="outline" 
              size="sm"
            >
              <School className="h-4 w-4 mr-2" />
              Escolas
            </Button>
          </div>
          <div className="flex items-center gap-4">
            <nav className="flex items-center gap-4">
              <Link to={`/school/${schoolSlug}/dashboard`}>
                <Button 
                  variant={location.pathname.includes("/dashboard") ? "default" : "ghost"} 
                  size="sm"
                >
                  <LayoutDashboard className="h-4 w-4 mr-2" />
                  Dashboard
                </Button>
              </Link>
              <Link to={`/school/${schoolSlug}/transactions`}>
                <Button 
                  variant={location.pathname.includes("/transactions") ? "default" : "ghost"} 
                  size="sm"
                >
                  <List className="h-4 w-4 mr-2" />
                  Lançamentos
                </Button>
              </Link>
              <Link to={`/school/${schoolSlug}/pending`}>
                <Button 
                  variant={location.pathname.includes("/pending") ? "default" : "ghost"} 
                  size="sm"
                >
                  <Clock className="h-4 w-4 mr-2" />
                  Pendências
                </Button>
              </Link>
              {school?.slug === 'paulo-freire' && (
                <Link to={`/school/${schoolSlug}/dfc-gerencial`}>
                  <Button 
                    variant={location.pathname.includes("/dfc-gerencial") ? "default" : "ghost"} 
                    size="sm"
                  >
                    <FileBarChart className="h-4 w-4 mr-2" />
                    DFC Gerencial
                  </Button>
                </Link>
              )}
              {isAdmin && (
                <>
                  <Link to={`/school/${schoolSlug}/users`}>
                    <Button 
                      variant={location.pathname.includes("/users") ? "default" : "ghost"} 
                      size="sm"
                    >
                      <Users className="h-4 w-4 mr-2" />
                      Usuários
                    </Button>
                  </Link>
                  <Link to={`/school/${schoolSlug}/admin/sync-monitor`}>
                    <Button 
                      variant={location.pathname.includes("/sync-monitor") ? "default" : "ghost"} 
                      size="sm"
                    >
                      <Activity className="h-4 w-4 mr-2" />
                      Sync Monitor
                    </Button>
                  </Link>
                </>
              )}
            </nav>
            <span className="text-sm text-muted-foreground">{user?.email}</span>
            <Button onClick={handleSignOut} variant="outline" size="sm">
              <LogOut className="h-4 w-4 mr-2" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
};
