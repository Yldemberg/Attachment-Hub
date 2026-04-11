import { useState } from "react";
import { Link, useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import logo from "@/assets/ihub-logo.png";

export default function Login() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      navigate("/dashboard");
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex">
      <div className="hidden lg:flex flex-1 bg-slate-900 items-center justify-center p-12">
        <div className="max-w-md">
          <div className="mb-8">
            <img src={logo} alt="iHub" className="h-36 w-auto object-contain" />
          </div>
          <h2 className="text-3xl font-bold text-white mb-4 leading-tight">
            Gestao total do seu Mercado Livre
          </h2>
          <p className="text-slate-400 text-lg leading-relaxed">
            Pedidos, estoque, perguntas e contas em um unico lugar. Decisoes rapidas, menos erros.
          </p>
          <div className="mt-10 grid grid-cols-2 gap-4">
            {[
              { label: "Tempo de resposta", value: "< 2s", sub: "para qualquer dado" },
              { label: "Contas simultaneas", value: "Ilimitado", sub: "todas conectadas" },
              { label: "Sincronizacao", value: "Em tempo real", sub: "via webhooks" },
              { label: "Estoque unificado", value: "Por SKU", sub: "multi-conta" },
            ].map((stat) => (
              <div key={stat.label} className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                <div className="text-blue-400 font-bold text-sm mb-1">{stat.value}</div>
                <div className="text-slate-200 text-xs font-medium">{stat.label}</div>
                <div className="text-slate-500 text-xs mt-0.5">{stat.sub}</div>
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

          <h1 className="text-2xl font-bold text-white mb-1">Entrar na conta</h1>
          <p className="text-slate-400 text-sm mb-8">
            Novo por aqui?{" "}
            <Link to="/auth/register" className="text-blue-400 hover:text-blue-300 transition-colors">
              Criar conta
            </Link>
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-slate-300 text-sm">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 focus:border-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-slate-300 text-sm">Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 focus:border-blue-500"
              />
            </div>

            {error && (
              <div className="bg-red-900/40 border border-red-800 rounded-md px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium"
            >
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
