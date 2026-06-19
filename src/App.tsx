import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { LoginGate } from "@/components/LoginGate";
import { ScannerFiltersProvider } from "@/contexts/ScannerFiltersContext";
import Home from "./pages/Home.tsx";
import Index from "./pages/Index.tsx";
import Admin from "./pages/Admin.tsx";
import OrgsAdmin from "./pages/OrgsAdmin.tsx";
import Scanner from "./pages/Scanner.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Protege a rota /admin — redireciona para / se não for admin
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useAuth();
  if (loading) return null;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <LanguageProvider>
          <ThemeProvider>
            <AuthProvider>
              <LoginGate>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/app" element={<Index />} />
                  <Route
                    path="/admin"
                    element={
                      <AdminRoute>
                        <Admin />
                      </AdminRoute>
                    }
                  />
                  <Route
                    path="/scanner"
                    element={
                      <ScannerFiltersProvider>
                        <Scanner />
                      </ScannerFiltersProvider>
                    }
                  />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </LoginGate>
            </AuthProvider>
          </ThemeProvider>
        </LanguageProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
