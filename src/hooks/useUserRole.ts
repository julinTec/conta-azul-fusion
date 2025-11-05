import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const useUserRole = () => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkUserRole();

    // Listen for auth state changes to re-check role
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      checkUserRole();
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkUserRole = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setIsAdmin(false);
        return;
      }

      // Primary check: query user_roles table
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .maybeSingle();

      if (error) {
        console.error('Error checking user role via table:', error);
        
        // Fallback: use RPC function for server-side validation
        try {
          const { data: hasAdminRole, error: rpcError } = await supabase
            .rpc('has_role', { 
              _user_id: user.id, 
              _role: 'admin' 
            });

          if (rpcError) {
            console.error('Error checking user role via RPC:', rpcError);
            setIsAdmin(false);
            return;
          }

          setIsAdmin(hasAdminRole || false);
        } catch (rpcError) {
          console.error('Error in RPC fallback:', rpcError);
          setIsAdmin(false);
        }
        return;
      }

      setIsAdmin(!!data);
    } catch (error) {
      console.error('Error checking user role:', error);
      setIsAdmin(false);
    } finally {
      setLoading(false);
    }
  };

  return { isAdmin, loading, refetch: checkUserRole };
};
