import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import SchoolSelection from "@/pages/SchoolSelection";

const Index = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to school selection by default
    navigate("/schools", { replace: true });
  }, [navigate]);

  return <SchoolSelection />;
};

export default Index;
