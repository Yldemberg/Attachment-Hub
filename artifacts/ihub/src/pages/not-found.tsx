import { AlertCircle } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="w-full max-w-md mx-4 bg-card border border-card-border rounded-xl p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-red-50 border border-red-200 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="h-7 w-7 text-red-500" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">404</h1>
        <p className="text-foreground font-medium mb-1">Página não encontrada</p>
        <p className="text-muted-foreground text-sm mb-6">
          A página que você está procurando não existe ou foi movida.
        </p>
        <Link to="/dashboard">
          <button className="bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            Voltar ao Dashboard
          </button>
        </Link>
      </div>
    </div>
  );
}
