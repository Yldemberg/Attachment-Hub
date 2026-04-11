import { useState } from "react";
import { Link, useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import logo from "@/assets/ihub-logo.png";

export default function Register() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signUp({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSuccess(true);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-8">
        <div className="max-w-sm w-full text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-900/50 border border-emerald-700 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Conta criada</h1>
          <p className="text-slate-400 text-sm mb-6">
            Confira seu email para verificar sua conta antes de entrar.
          </p>
          <Link to="/auth/login">
            <Button variant="outline" className="border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800">
              Ir para o login
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <img src={logo} alt="iHub" className="h-9 w-auto object-contain" />
        </div>

        <h1 className="text-2xl font-bold text-white mb-1">Criar conta</h1>
        <p className="text-slate-400 text-sm mb-8">
          Ja tem conta?{" "}
          <Link to="/auth/login" className="text-blue-400 hover:text-blue-300 transition-colors">
            Entrar
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
              minLength={6}
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
            {loading ? "Criando conta..." : "Criar conta — 30 dias gratis"}
          </Button>
        </form>

        <p className="text-slate-600 text-xs mt-4 text-center">
          Trial de 30 dias. Nenhum cartao de credito necessario.
        </p>
      </div>
    </div>
  );
}
