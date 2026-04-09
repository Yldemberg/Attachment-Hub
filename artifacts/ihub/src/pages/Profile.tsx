import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/utils";
import { User, CreditCard, Calendar, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

interface UserProfile {
  id: string;
  fullName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  plan?: string;
  trialEndsAt?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  createdAt?: string;
}

const PLAN_LABELS: Record<string, string> = {
  trial: "Trial",
  basic: "Basico",
  pro: "Pro",
};

const PLAN_COLORS: Record<string, string> = {
  trial: "bg-amber-900/40 text-amber-400 border-amber-800/50",
  basic: "bg-blue-900/40 text-blue-400 border-blue-800/50",
  pro: "bg-purple-900/40 text-purple-400 border-purple-800/50",
};

function TrialCountdown({ endsAt }: { endsAt: string }) {
  const end = new Date(endsAt);
  const now = new Date();
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysLeft <= 0) {
    return <span className="text-red-400 text-sm font-medium">Trial expirado</span>;
  }

  return (
    <span className={`text-sm font-medium ${daysLeft <= 7 ? "text-red-400" : "text-amber-400"}`}>
      {daysLeft} dias restantes
    </span>
  );
}

export default function Profile() {
  const { user, signOut } = useAuth();
  const { data: profile, isLoading } = useGetMe({
    query: { queryKey: getGetMeQueryKey() },
  });
  const p = profile as UserProfile | null;

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        <div className="h-6 w-32 bg-slate-800 rounded animate-pulse" />
        <div className="h-32 bg-slate-900 border border-slate-800 rounded-lg animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-2xl">
      <h1 className="text-xl font-bold text-white">Perfil</h1>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-14 h-14 rounded-full bg-blue-900/40 border border-blue-800/30 flex items-center justify-center flex-shrink-0">
            <User className="w-7 h-7 text-blue-400" />
          </div>
          <div>
            <h2 className="text-white font-semibold">
              {p?.fullName ?? user?.email?.split("@")[0] ?? "Usuario"}
            </h2>
            <p className="text-slate-400 text-sm">{user?.email ?? p?.email}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-slate-500 text-xs">Membro desde</p>
            <p className="text-white text-sm mt-0.5">{formatDate(p?.createdAt ?? user?.created_at)}</p>
          </div>
          <div>
            <p className="text-slate-500 text-xs">ID do usuario</p>
            <p className="text-white text-xs mt-0.5 font-mono">{user?.id?.slice(0, 12)}...</p>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="w-4 h-4 text-slate-400" />
          <h3 className="text-white text-sm font-semibold">Assinatura</h3>
        </div>

        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-slate-500 text-xs mb-1">Plano atual</p>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium px-2.5 py-1 rounded border ${PLAN_COLORS[p?.plan ?? "trial"] ?? PLAN_COLORS.trial}`}>
                {PLAN_LABELS[p?.plan ?? "trial"] ?? p?.plan}
              </span>
            </div>
          </div>

          {p?.plan === "trial" && p.trialEndsAt && (
            <div className="text-right">
              <p className="text-slate-500 text-xs mb-0.5">Trial termina em</p>
              <TrialCountdown endsAt={p.trialEndsAt} />
            </div>
          )}

          {p?.plan !== "trial" && (
            <div className="text-right">
              <p className="text-slate-500 text-xs mb-0.5">Status</p>
              <div className="flex items-center gap-1">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 text-sm font-medium">Ativo</span>
              </div>
            </div>
          )}
        </div>

        {p?.plan === "trial" && (
          <div className="bg-blue-950/30 border border-blue-800/30 rounded-lg p-3 flex items-start gap-3">
            <Calendar className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-blue-300 text-xs font-medium">Trial gratuito</p>
              <p className="text-slate-400 text-xs mt-0.5">
                Apos o trial, assine para continuar gerenciando todas as suas contas. Precos a partir de R$49/mes.
              </p>
            </div>
          </div>
        )}

        {p?.stripeCustomerId && (
          <div className="mt-3 pt-3 border-t border-slate-800">
            <p className="text-slate-500 text-xs">Gerenciar assinatura via Stripe</p>
          </div>
        )}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex items-center justify-between">
        <div>
          <p className="text-slate-300 text-sm font-medium">Sair da conta</p>
          <p className="text-slate-500 text-xs mt-0.5">Encerra sua sessao em todos os dispositivos</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={signOut}
          className="border-red-900/50 text-red-400 hover:text-red-300 hover:bg-red-900/20"
        >
          Sair
        </Button>
      </div>
    </div>
  );
}
