import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth-context";
import logo from "@/assets/ihub-logo.png";

const API_BASE = import.meta.env.VITE_API_URL || "";

export default function Login() {
  const [, navigate] = useLocation();
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session) {
    navigate("/dashboard");
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error?.message ?? "Erro ao entrar");
        return;
      }

      navigate("/dashboard");
      window.location.reload();
    } catch {
      setError("Não foi possível conectar ao servidor");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex">
      <div className="hidden lg:flex flex-1 bg-sidebar items-center justify-center p-12 border-r border-sidebar-border">
        <div className="max-w-md">
          <div className="mb-8">
            <img src={logo} alt="iHub" className="h-36 w-auto object-contain" />
          </div>
          <h2 className="text-3xl font-bold text-foreground mb-4 leading-tight">
            Gestão total do seu Mercado Livre
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Pedidos, estoque, perguntas e contas em um único lugar. Decisões rápidas, menos erros.
          </p>
          <div className="mt-10 grid grid-cols-2 gap-4">
            {[
              { label: "Tempo de resposta", value: "< 2s", sub: "para qualquer dado" },
              { label: "Contas simultâneas", value: "Ilimitado", sub: "todas conectadas" },
              { label: "Sincronização", value: "Em tempo real", sub: "via webhooks" },
              { label: "Estoque unificado", value: "Por SKU", sub: "multi-conta" },
            ].map((stat) => (
              <div key={stat.label} className="bg-card rounded-xl p-4 border border-card-border">
                <div className="text-primary font-bold text-sm mb-1">{stat.value}</div>
                <div className="text-foreground text-xs font-medium">{stat.label}</div>
                <div className="text-muted-foreground text-xs mt-0.5">{stat.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 lg:max-w-md flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <img src={logo} alt="iHub" className="h-24 w-auto object-contain" />
          </div>

          <h1 className="text-2xl font-bold text-foreground mb-1">Entrar na conta</h1>
          <p className="text-muted-foreground text-sm mb-8">
            Novo por aqui?{" "}
            <Link to="/auth/register" className="text-primary hover:text-primary/80 transition-colors font-medium">
              Criar conta
            </Link>
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm">Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-600">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full font-medium"
            >
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
