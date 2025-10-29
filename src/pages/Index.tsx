import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Dashboard } from "@/pages/Dashboard";

const Index = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to dashboard by default
    navigate("/dashboard", { replace: true });
  }, [navigate]);

  return (
    <Layout>
      <Dashboard />
    </Layout>
  );
};

export default Index;
