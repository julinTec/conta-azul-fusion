import { useNavigate } from "react-router-dom";
import { useUserRole } from "@/hooks/useUserRole";
import colegioLogo from "@/assets/colegio-paulo-freire.png";

const SchoolSelection = () => {
  const navigate = useNavigate();
  const { isAdmin } = useUserRole();

  const handleSchoolClick = () => {
    navigate("/dashboard");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold text-foreground mb-12 text-center">
        Selecione a escola para visualizar
      </h1>
      
      <button
        onClick={handleSchoolClick}
        className="transition-all duration-300 hover:scale-105 hover:shadow-2xl rounded-lg overflow-hidden bg-card border-2 border-border hover:border-primary p-8"
      >
        <img 
          src={colegioLogo} 
          alt="Colégio Paulo Freire" 
          className="w-96 h-auto"
        />
      </button>
    </div>
  );
};

export default SchoolSelection;
