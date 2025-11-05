import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AdminGuardProps {
  children: React.ReactNode;
}

export const AdminGuard = ({ children }: AdminGuardProps) => {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    checkAdminAccess();
  }, []);

  const checkAdminAccess = async () => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      
      if (userError || !user) {
        toast.error("Acesso negado");
        navigate("/dashboard");
        return;
      }

      // Use RPC function for server-side validation
      const { data: hasAdminRole, error: rpcError } = await supabase
        .rpc('has_role', { 
          _user_id: user.id, 
          _role: 'admin' 
        });

      if (rpcError) {
        console.error('Error checking admin role:', rpcError);
        toast.error("Acesso negado");
        navigate("/dashboard");
        return;
      }

      if (!hasAdminRole) {
        toast.error("Você não tem permissão para acessar esta página");
        navigate("/dashboard");
        return;
      }

      setIsAdmin(true);
    } catch (error) {
      console.error('Error in AdminGuard:', error);
      toast.error("Erro ao verificar permissões");
      navigate("/dashboard");
    }
  };

  // Show loading while checking
  if (isAdmin === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Only render children if user is admin
  return isAdmin ? <>{children}</> : null;
};
