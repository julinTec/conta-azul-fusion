import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import colegioLogo from "@/assets/colegio-paulo-freire.png";
import aventurandoLogo from "@/assets/colegio-aventurando.png";
import renascerLogo from "@/assets/colegio-renascer.png";
import conectivoLogo from "@/assets/colegio-conectivo.png";
import exodusLogo from "@/assets/colegio-exodus.png";
import cristaGomesLogo from "@/assets/colegio-crista-gomes.png";
import redeBloomLogo from "@/assets/rede-bloom.png";
import { Loader2 } from "lucide-react";

interface School {
  id: string;
  name: string;
  slug: string;
  logo_url: string;
}

const SchoolSelection = () => {
  const navigate = useNavigate();
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      navigate("/auth", { replace: true });
      return;
    }
    
    setCheckingAuth(false);
  };

  useEffect(() => {
    if (!checkingAuth) {
      loadSchools();
    }
  }, [checkingAuth]);

  const loadSchools = async () => {
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('*')
        .order('name');
      
      if (error) {
        console.error('Error loading schools:', error);
      } else if (data) {
        setSchools(data);
      }
    } catch (error) {
      console.error('Error loading schools:', error);
    } finally {
      setLoading(false);
    }
  };

  const getSchoolLogo = (slug: string) => {
    if (slug === 'paulo-freire') return colegioLogo;
    if (slug === 'aventurando') return aventurandoLogo;
    if (slug === 'renascer') return renascerLogo;
    if (slug === 'conectivo') return conectivoLogo;
    if (slug === 'exodus') return exodusLogo;
    if (slug === 'crista-gomes') return cristaGomesLogo;
    if (slug === 'rede-bloom') return redeBloomLogo;
    return colegioLogo;
  };

  const handleSchoolClick = (slug: string) => {
    navigate(`/school/${slug}/dashboard`);
  };

  if (checkingAuth || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold text-foreground mb-8 text-center">
        Selecione a escola para visualizar
      </h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl">
        {schools.map((school) => (
          <button
            key={school.id}
            onClick={() => handleSchoolClick(school.slug)}
            className="transition-all duration-300 hover:scale-105 hover:shadow-2xl rounded-lg overflow-hidden bg-card border-2 border-border hover:border-primary p-4 flex flex-col items-center justify-center min-h-[160px]"
          >
            <img 
              src={getSchoolLogo(school.slug)} 
              alt={school.name} 
              className="w-full h-auto max-w-[160px] object-contain"
            />
            <p className="mt-4 text-sm font-medium text-foreground text-center">
              {school.name}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
};

export default SchoolSelection;
