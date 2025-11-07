import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

interface School {
  id: string;
  name: string;
  slug: string;
  logo_url: string;
  created_at?: string;
}

interface SchoolContextType {
  school: School | null;
  loading: boolean;
}

const SchoolContext = createContext<SchoolContextType>({ 
  school: null, 
  loading: true 
});

export const SchoolProvider = ({ children }: { children: ReactNode }) => {
  const { schoolSlug } = useParams();
  const [school, setSchool] = useState<School | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (schoolSlug) {
      loadSchool(schoolSlug);
    } else {
      setLoading(false);
    }
  }, [schoolSlug]);

  const loadSchool = async (slug: string) => {
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();
      
      if (error) {
        console.error('Error loading school:', error);
      } else if (data) {
        setSchool(data);
      }
    } catch (error) {
      console.error('Error loading school:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SchoolContext.Provider value={{ school, loading }}>
      {children}
    </SchoolContext.Provider>
  );
};

export const useSchool = () => useContext(SchoolContext);
