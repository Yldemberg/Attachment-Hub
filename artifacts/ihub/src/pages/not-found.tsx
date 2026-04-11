import { AlertCircle } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#080f1e]">
      <div className="w-full max-w-md mx-4 bg-[#0d1b2e] border border-[#1a3055]/60 rounded-xl p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-red-900/30 border border-red-800/40 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="h-7 w-7 text-red-400" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">404</h1>
        <p className="text-blue-200 font-medium mb-1">Página não encontrada</p>
        <p className="text-blue-400/70 text-sm mb-6">
          A página que você está procurando não existe ou foi movida.
        </p>
        <Link to="/dashboard">
          <button className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            Voltar ao Dashboard
          </button>
        </Link>
      </div>
    </div>
  );
}
