import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Transactions } from "./pages/Transactions";
import UserManagement from "./pages/UserManagement";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import AuthCallback from "./pages/AuthCallback";
import NotFound from "./pages/NotFound";
import SchoolSelection from "./pages/SchoolSelection";
import { AdminGuard } from "./components/AdminGuard";
import { AdminPanel } from "./components/AdminPanel";
import { SchoolProvider } from "./contexts/SchoolContext";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <SchoolProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/schools" element={<SchoolSelection />} />
            
            {/* Rotas dinâmicas por escola */}
            <Route path="/school/:schoolSlug/dashboard" element={<Layout><Dashboard /></Layout>} />
            <Route path="/school/:schoolSlug/transactions" element={<Layout><Transactions /></Layout>} />
            <Route path="/school/:schoolSlug/users" element={<AdminGuard><Layout><UserManagement /></Layout></AdminGuard>} />
            <Route path="/school/:schoolSlug/admin/integrations" element={<AdminGuard><Layout><AdminPanel /></Layout></AdminGuard>} />
            
            {/* Rotas legadas - redirecionar para seleção de escola */}
            <Route path="/dashboard" element={<Navigate to="/schools" replace />} />
            <Route path="/transactions" element={<Navigate to="/schools" replace />} />
            <Route path="/users" element={<Navigate to="/schools" replace />} />
            <Route path="/admin/integrations" element={<Navigate to="/schools" replace />} />
            
            <Route path="/auth" element={<Auth />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </SchoolProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
