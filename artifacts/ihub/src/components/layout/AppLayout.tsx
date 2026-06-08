import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import {
  useListNotifications,
  useListQuestions,
  useGetMe,
  getListNotificationsQueryKey,
  getListQuestionsQueryKey,
  getGetMeQueryKey,
  ListQuestionsStatus,
} from "@workspace/api-client-react";
import {
  LayoutDashboard,
  Package,
  Warehouse,
  ShoppingCart,
  MessageSquare,
  Bell,
  Plug,
  User,
  LogOut,
  ChevronRight,
  X,
  Clock,
  FileSpreadsheet,
  Tag,
} from "lucide-react";
import logo from "@/assets/ihub-logo.png";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useQuestionNotificationAlerts } from "@/hooks/use-question-notification-alerts";
import { DemoBanner } from "./DemoBanner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const navItems = [
  { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard, badge: "none" as const },
  { path: "/products", label: "Produtos", icon: Package, badge: "none" as const },
  { path: "/promotions", label: "Promoções", icon: Tag, badge: "none" as const },
  { path: "/inventory", label: "Inventário geral", icon: Warehouse, badge: "none" as const },
  { path: "/reports/sales", label: "Relatório de vendas", icon: FileSpreadsheet, badge: "none" as const },
  { path: "/orders", label: "Pedidos", icon: ShoppingCart, badge: "none" as const },
  { path: "/questions", label: "Perguntas", icon: MessageSquare, badge: "questions" as const },
  { path: "/notifications", label: "Notificacoes", icon: Bell, badge: "notifications" as const },
  { path: "/integrations", label: "Integracoes", icon: Plug, badge: "none" as const },
];

const allNavItems = [
  ...navItems,
  { path: "/profile", label: "Perfil", icon: User, badge: "none" as const },
];

interface AppLayoutProps {
  children: React.ReactNode;
}

function TrialBanner({ trialEndsAt }: { trialEndsAt: string }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const end = new Date(trialEndsAt);
  const now = new Date();
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysLeft > 7) return null;

  const expired = daysLeft <= 0;

  return (
    <div className={cn(
      "flex items-center justify-between px-4 py-2 text-xs font-medium flex-shrink-0",
      expired
        ? "bg-red-50 border-b border-red-200 text-red-700"
        : "bg-amber-50 border-b border-amber-200 text-amber-700"
    )}>
      <div className="flex items-center gap-2">
        <Clock className="w-3.5 h-3.5 flex-shrink-0" />
        {expired
          ? "Seu trial expirou. Assine para continuar usando o iHub."
          : `Seu trial expira em ${daysLeft} dia${daysLeft === 1 ? "" : "s"}.`}
        <Link to="/profile" className="underline hover:no-underline ml-1">
          Ver planos
        </Link>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="ml-4 hover:opacity-70 transition-opacity"
        aria-label="Fechar"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, signOut } = useAuth();
  const [location] = useLocation();

  const { data: notifData } = useListNotifications(
    { is_read: false, limit: 99 },
    { query: { queryKey: getListNotificationsQueryKey({ is_read: false, limit: 99 }), refetchInterval: 12000 } },
  );
  const unreadNotifCount = notifData?.data?.length ?? 0;

  useQuestionNotificationAlerts(notifData);

  const { data: questionsData } = useListQuestions(
    { status: ListQuestionsStatus.unanswered, limit: 99 },
    { query: { queryKey: getListQuestionsQueryKey({ status: ListQuestionsStatus.unanswered, limit: 99 }), refetchInterval: 60000 } },
  );
  const unansweredCount = (questionsData as { data?: unknown[] } | null)?.data?.length ?? 0;

  const { data: meData } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const me = meData as { plan?: string; trialEndsAt?: string | null } | null;

  const initials = user?.email?.slice(0, 2).toUpperCase() ?? "??";

  function getBadge(badge: "questions" | "notifications" | "none"): number {
    if (badge === "questions") return unansweredCount;
    if (badge === "notifications") return unreadNotifCount;
    return 0;
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <aside className="hidden md:flex w-56 flex-shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="h-14 flex items-center px-4 border-b border-sidebar-border flex-shrink-0">
          <img src={logo} alt="iHub" className="h-9 w-auto object-contain" />
        </div>

        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {navItems.map(({ path, label, icon: Icon, badge }) => {
            const active = location === path || location.startsWith(path + "/");
            const count = getBadge(badge);
            return (
              <Link
                key={path}
                to={path}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors relative",
                  active
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-sidebar-foreground hover:text-foreground hover:bg-sidebar-accent",
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1">{label}</span>
                {count > 0 && (
                  <span className="bg-primary text-primary-foreground text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {count > 99 ? "99+" : count}
                  </span>
                )}
                {active && (
                  <ChevronRight className="w-3 h-3 text-primary" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-2 border-t border-sidebar-border flex-shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-sidebar-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors">
                <Avatar className="w-6 h-6">
                  <AvatarFallback className="text-[10px] bg-sidebar-accent text-sidebar-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="flex-1 text-left truncate text-xs">
                  {user?.email ?? "User"}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-48 bg-card border-border">
              <DropdownMenuItem asChild className="text-foreground hover:text-foreground focus:text-foreground focus:bg-accent">
                <Link to="/profile">
                  <User className="w-4 h-4 mr-2" />
                  Perfil
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-destructive hover:text-destructive focus:text-destructive focus:bg-accent cursor-pointer"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="md:hidden h-14 flex items-center px-4 border-b border-sidebar-border bg-sidebar flex-shrink-0">
          <img src={logo} alt="iHub" className="h-8 w-auto object-contain" />
        </header>

        <DemoBanner />

        {me?.plan === "trial" && me.trialEndsAt && (
          <TrialBanner trialEndsAt={me.trialEndsAt} />
        )}

        <main className="flex-1 overflow-hidden pb-16 md:pb-0">
          {children}
        </main>

        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-sidebar border-t border-sidebar-border z-50">
          <div className="flex items-stretch overflow-x-auto">
            {allNavItems.map(({ path, label, icon: Icon, badge }) => {
              const active = location === path || location.startsWith(path + "/");
              const count = getBadge(badge);
              return (
                <Link
                  key={path}
                  to={path}
                  className={cn(
                    "flex-1 min-w-[52px] flex flex-col items-center justify-center py-2 gap-0.5 relative transition-colors",
                    active ? "text-primary" : "text-sidebar-foreground/60 hover:text-sidebar-foreground"
                  )}
                >
                  <div className="relative">
                    <Icon className="w-5 h-5" />
                    {count > 0 && (
                      <span className="absolute -top-1.5 -right-2 bg-primary text-primary-foreground text-[9px] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-0.5">
                        {count > 99 ? "99+" : count}
                      </span>
                    )}
                  </div>
                  <span className="text-[9px] leading-none">{label.split(" ")[0]}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
