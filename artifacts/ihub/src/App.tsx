import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth-context";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";

import Login from "@/pages/auth/Login";
import Register from "@/pages/auth/Register";
import Dashboard from "@/pages/Dashboard";
import Products from "@/pages/products/Products";
import ProductDetail from "@/pages/products/ProductDetail";
import Orders from "@/pages/orders/Orders";
import OrderDetail from "@/pages/orders/OrderDetail";
import Questions from "@/pages/Questions";
import Notifications from "@/pages/Notifications";
import Integrations from "@/pages/Integrations";
import Profile from "@/pages/Profile";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function NotFound() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <p className="text-6xl font-bold text-slate-700 mb-4">404</p>
        <h1 className="text-xl font-semibold text-slate-300 mb-2">Pagina nao encontrada</h1>
        <p className="text-slate-500 text-sm">A pagina que voce procura nao existe.</p>
      </div>
    </div>
  );
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/auth/login" component={Login} />
      <Route path="/auth/register" component={Register} />

      <Route path="/dashboard">
        <ProtectedRoute>
          <AppLayout>
            <Dashboard />
          </AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/products/:id">
        {({ id }: { id: string }) => (
          <ProtectedRoute>
            <AppLayout>
              <ProductDetail />
            </AppLayout>
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/products">
        <ProtectedRoute>
          <AppLayout>
            <Products />
          </AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/orders/:id">
        {() => (
          <ProtectedRoute>
            <AppLayout>
              <OrderDetail />
            </AppLayout>
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/orders">
        <ProtectedRoute>
          <AppLayout>
            <Orders />
          </AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/questions">
        <ProtectedRoute>
          <AppLayout>
            <Questions />
          </AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/notifications">
        <ProtectedRoute>
          <AppLayout>
            <Notifications />
          </AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/integrations">
        <ProtectedRoute>
          <AppLayout>
            <Integrations />
          </AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/profile">
        <ProtectedRoute>
          <AppLayout>
            <Profile />
          </AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/">
        <Redirect to="/dashboard" />
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
