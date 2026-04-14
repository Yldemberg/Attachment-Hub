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
  basic: "Básico",
  pro: "Pro",
};

const PLAN_COLORS: Record<string, string> = {
  trial: "bg-amber-50 text-amber-700 border-amber-200",
  basic: "bg-sky-50 text-sky-700 border-sky-200",
  pro: "bg-violet-50 text-violet-700 border-violet-200",
};

function TrialCountdown({ endsAt }: { endsAt: string }) {
  const end = new Date(endsAt);
  const now = new Date();
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysLeft <= 0) {
    return <span className="text-red-600 text-sm font-medium">Trial expirado</span>;
  }

  return (
    <span className={`text-sm font-medium ${daysLeft <= 7 ? "text-red-600" : "text-amber-600"}`}>
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
      <div className="h-full overflow-y-auto bg-background p-6 space-y-3">
        <div className="h-6 w-32 bg-muted rounded animate-pulse" />
        <div className="h-32 bg-card border border-card-border rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-6 space-y-4 max-w-2xl">
        <h1 className="text-xl font-bold text-foreground">Perfil</h1>

        <div className="bg-card border border-card-border rounded-xl p-5">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
              <User className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h2 className="text-foreground font-semibold">
                {p?.fullName ?? user?.email?.split("@")[0] ?? "Usuario"}
              </h2>
              <p className="text-muted-foreground text-sm">{user?.email ?? p?.email}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-muted-foreground text-xs">Membro desde</p>
              <p className="text-foreground text-sm mt-0.5">{formatDate(p?.createdAt)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">ID do usuário</p>
              <p className="text-foreground text-xs mt-0.5 font-mono">{user?.id?.slice(0, 12)}...</p>
            </div>
          </div>
        </div>

        <div className="bg-card border border-card-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="w-4 h-4 text-primary" />
            <h3 className="text-foreground text-sm font-semibold">Assinatura</h3>
          </div>

          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-muted-foreground text-xs mb-1">Plano atual</p>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium px-2.5 py-1 rounded-lg border ${PLAN_COLORS[p?.plan ?? "trial"] ?? PLAN_COLORS.trial}`}>
                  {PLAN_LABELS[p?.plan ?? "trial"] ?? p?.plan}
                </span>
              </div>
            </div>

            {p?.plan === "trial" && p.trialEndsAt && (
              <div className="text-right">
                <p className="text-muted-foreground text-xs mb-0.5">Trial termina em</p>
                <TrialCountdown endsAt={p.trialEndsAt} />
              </div>
            )}

            {p?.plan !== "trial" && (
              <div className="text-right">
                <p className="text-muted-foreground text-xs mb-0.5">Status</p>
                <div className="flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-emerald-600 text-sm font-medium">Ativo</span>
                </div>
              </div>
            )}
          </div>

          {p?.plan === "trial" && (
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 flex items-start gap-3">
              <Calendar className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-foreground text-xs font-medium">Trial gratuito</p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  Após o trial, assine para continuar gerenciando todas as suas contas. Preços a partir de R$49/mês.
                </p>
              </div>
            </div>
          )}

          {p?.stripeCustomerId && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-muted-foreground text-xs">Gerenciar assinatura via Stripe</p>
            </div>
          )}
        </div>

        <div className="bg-card border border-card-border rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-foreground text-sm font-medium">Sair da conta</p>
            <p className="text-muted-foreground text-xs mt-0.5">Encerra sua sessão em todos os dispositivos</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={signOut}
            className="border-red-200 text-red-500 hover:text-red-600 hover:bg-red-50"
          >
            Sair
          </Button>
        </div>
      </div>
    </div>
  );
}
