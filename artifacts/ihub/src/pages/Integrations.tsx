import {
  useListAccounts,
  useDeleteAccount,
  useSyncAccount,
  useUpsertMpCredentials,
  useDeleteMpCredentials,
  getListAccountsQueryKey,
  getConnectUrl,
  ApiError,
} from "@workspace/api-client-react";
import { formatDateTime } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plug, Plus, RefreshCw, Trash2, CheckCircle, XCircle,
  Loader2, Copy, Check, Store, ShieldCheck, ShieldOff, ChevronDown, ChevronUp, Eye, EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { useSearch, useLocation } from "wouter";

interface Account {
  id: string;
  mlNickname?: string | null;
  mlEmail?: string | null;
  mlUserId?: string | null;
  isActive?: boolean | null;
  lastSyncAt?: string | null;
  hasMpCredentials?: boolean;
  mpClientIdMasked?: string | null;
  mpClientSecretMasked?: string | null;
}

function ConnectButton() {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { signOut } = useAuth();

  const handleConnect = async () => {
    setLoading(true);
    try {
      const data = await getConnectUrl();
      const url = (data as { url?: string } | null)?.url;
      if (!url) throw new Error("URL não retornada");
      window.location.href = url;
    } catch (err) {
      let description = "Não foi possível iniciar a conexão com o Mercado Livre. Tente novamente.";
      let forceRelogin = false;

      if (err instanceof ApiError) {
        if (err.status === 401) {
          description = "Sessão expirada. Você será redirecionado para o login.";
          forceRelogin = true;
        } else if (err.status === 402 || err.status === 403) {
          description = "Seu plano não permite conectar contas no momento.";
        } else if (err.status === 500) {
          description = "Erro interno no servidor. Verifique as credenciais de OAuth do Mercado Livre nas configurações.";
        } else if (err.status === 503) {
          description = "Serviço temporariamente indisponível. Tente novamente em instantes.";
        } else if (err.status >= 500) {
          description = "Erro interno do servidor. Verifique as configurações do servidor.";
        }
      }

      toast({
        variant: "destructive",
        title: "Erro ao conectar",
        description,
      });

      if (forceRelogin) {
        setTimeout(async () => {
          await signOut();
        }, 2000);
        return;
      }

      setLoading(false);
    }
  };

  return (
    <Button
      onClick={handleConnect}
      disabled={loading}
      className="gap-2"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
      Conectar conta ML
    </Button>
  );
}

function ConnectComingSoonButton({ marketplace }: { marketplace: "Shopee" | "Amazon" }) {
  const { toast } = useToast();

  return (
    <Button
      variant="outline"
      size="sm"
      className="mt-3 h-8 text-xs w-full"
      onClick={() =>
        toast({
          title: `${marketplace} em breve`,
          description: `O botão de conexão da ${marketplace} já está preparado e será ativado quando a integração estiver disponível.`,
        })
      }
    >
      Conectar {marketplace}
    </Button>
  );
}

function WebhookUrlCard() {
  const [copied, setCopied] = useState(false);
  const webhookUrl = `${window.location.origin}/api/webhooks/mercadolivre`;
  const { toast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ variant: "destructive", title: "Não foi possível copiar", description: "Copie manualmente: " + webhookUrl });
    }
  };

  return (
    <div className="bg-card border border-card-border rounded-xl p-4 space-y-3">
      <div>
        <h3 className="text-foreground text-sm font-medium">Notificações em Tempo Real</h3>
        <p className="text-muted-foreground text-xs mt-0.5">
          Configure esta URL no seu app do Mercado Livre Developer para receber atualizações instantâneas de pedidos, perguntas e anúncios.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <code className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-xs text-primary font-mono truncate select-all">
          {webhookUrl}
        </code>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopy}
          className="h-8 px-3 gap-1.5 flex-shrink-0"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Copiado!" : "Copiar URL"}
        </Button>
      </div>

      <div className="space-y-1 text-muted-foreground text-xs">
        <p className="font-medium text-foreground">Como configurar no ML Developer:</p>
        <p>1. Acesse <span className="text-primary">developers.mercadolivre.com.br</span> → seu app → Notificações</p>
        <p>2. Cole a URL acima no campo "URL de notificação"</p>
        <p>3. Ative os tópicos: <span className="text-foreground">orders_v2</span>, <span className="text-foreground">questions</span>, <span className="text-foreground">items</span></p>
        <p>4. Salve — o iHub começará a receber atualizações em tempo real</p>
      </div>
    </div>
  );
}

interface MpCredentialsPanelProps {
  account: Account;
  onUpdated: () => void;
}

function MpCredentialsPanel({ account, onUpdated }: MpCredentialsPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const { mutate: save, isPending: saving } = useUpsertMpCredentials({
    mutation: {
      onSuccess: () => {
        toast({ title: "Credenciais MP salvas", description: "As credenciais do app Mercado Pago foram salvas com sucesso." });
        setClientId("");
        setClientSecret("");
        setAccessToken("");
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
        onUpdated();
      },
      onError: () => {
        toast({ variant: "destructive", title: "Erro ao salvar", description: "Não foi possível salvar as credenciais. Tente novamente." });
      },
    },
  });

  const { mutate: remove, isPending: removing } = useDeleteMpCredentials({
    mutation: {
      onSuccess: () => {
        toast({ title: "Credenciais removidas", description: "As credenciais do app Mercado Pago foram removidas." });
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
        onUpdated();
      },
      onError: () => {
        toast({ variant: "destructive", title: "Erro ao remover", description: "Não foi possível remover as credenciais." });
      },
    },
  });

  const handleSave = () => {
    if (!clientId.trim() || !clientSecret.trim() || !accessToken.trim()) {
      toast({ variant: "destructive", title: "Campos obrigatórios", description: "Preencha Client ID, Client Secret e Access Token." });
      return;
    }
    save({
      id: account.id,
      data: { mpClientId: clientId.trim(), mpClientSecret: clientSecret.trim(), mpAccessToken: accessToken.trim() },
    });
  };

  return (
    <div className="mt-3 border-t border-card-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
      >
        {account.hasMpCredentials ? (
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
        ) : (
          <ShieldOff className="w-3.5 h-3.5 text-muted-foreground/60 flex-shrink-0" />
        )}
        <span className="flex-1">
          {account.hasMpCredentials
            ? <>App Mercado Pago <span className="text-muted-foreground/60 font-normal">· {account.mpClientIdMasked ?? "configurado"}</span></>
            : "Configurar app Mercado Pago"}
        </span>
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Insira as credenciais do seu app MP. Encontre-as em{" "}
            <span className="text-primary">developers.mercadopago.com.br</span> → Credenciais.
          </p>

          <div className="space-y-2">
            <div>
              <Label className="text-xs text-muted-foreground">Client ID</Label>
              <Input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder={account.hasMpCredentials ? `•••${account.mpClientIdMasked ?? "****"}` : "Ex: 123456789"}
                className="h-8 text-xs mt-1 bg-muted/50 border-border"
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Client Secret</Label>
              <div className="relative mt-1">
                <Input
                  type={showSecret ? "text" : "password"}
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder={account.hasMpCredentials ? "••••••••••••" : "Client Secret do app"}
                  className="h-8 text-xs pr-8 bg-muted/50 border-border"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Access Token de Produção</Label>
              <div className="relative mt-1">
                <Input
                  type={showToken ? "text" : "password"}
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder={account.hasMpCredentials ? "••••••••••••" : "APP_USR-..."}
                  className="h-8 text-xs pr-8 bg-muted/50 border-border"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="h-7 text-xs px-3 gap-1.5"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
              Salvar credenciais
            </Button>

            {account.hasMpCredentials && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={removing}
                    className="h-7 text-xs px-3 gap-1.5 border-red-200 text-red-500 hover:text-red-600 hover:bg-red-50"
                  >
                    {removing ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldOff className="w-3 h-3" />}
                    Remover
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remover credenciais MP</AlertDialogTitle>
                    <AlertDialogDescription>
                      Tem certeza que deseja remover as credenciais do app Mercado Pago da conta{" "}
                      <span className="text-foreground font-medium">{account.mlNickname ?? account.id}</span>?
                      As chamadas à API do Mercado Pago voltarão a usar o token OAuth do ML.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => remove({ id: account.id })}
                      className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                    >
                      Remover
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              className="h-7 text-xs px-2 ml-auto text-muted-foreground"
            >
              Fechar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const SYNC_POLL_INTERVAL = 3000;
const SYNC_TIMEOUT_MS = 120_000;

export default function Integrations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const searchStr = useSearch();
  const [, navigate] = useLocation();

  const [syncingAccounts, setSyncingAccounts] = useState<Record<string, string | null>>({});
  const syncTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const timeouts = syncTimeoutsRef.current;
    return () => {
      Object.values(timeouts).forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    const searchParams = new URLSearchParams(searchStr);
    const success = searchParams.get("success");
    const error = searchParams.get("error");
    if (success === "true") {
      toast({ title: "Conta conectada!", description: "Sua conta do Mercado Livre foi conectada com sucesso. A sincronização iniciará em breve." });
      navigate("/integrations", { replace: true } as never);
    } else if (error) {
      const messages: Record<string, string> = {
        missing_params: "Parâmetros inválidos no retorno do Mercado Livre.",
        invalid_state: "Sessão expirada. Tente conectar novamente.",
        account_already_linked: "Esta conta do ML já está vinculada a outro usuário.",
        oauth_failed: "Falha na autenticação com o Mercado Livre. Tente novamente.",
      };
      toast({ variant: "destructive", title: "Erro ao conectar", description: messages[error] ?? "Erro desconhecido." });
      navigate("/integrations", { replace: true } as never);
    }
  }, []);

  const { data: accountsData, isLoading, refetch: refetchAccounts } = useListAccounts({
    query: {
      queryKey: getListAccountsQueryKey(),
      refetchInterval: Object.keys(syncingAccounts).length > 0 ? SYNC_POLL_INTERVAL : false,
    },
  });
  const accounts: Account[] = (accountsData as { data?: Account[] } | null)?.data ?? [];

  useEffect(() => {
    const syncing = Object.keys(syncingAccounts);
    if (syncing.length === 0 || accounts.length === 0) return;

    for (const accountId of syncing) {
      const prevLastSyncAt = syncingAccounts[accountId];
      const current = accounts.find((a) => a.id === accountId);
      if (!current) continue;

      const currentLastSyncAt = current.lastSyncAt ?? null;
      if (currentLastSyncAt !== prevLastSyncAt) {
        clearTimeout(syncTimeoutsRef.current[accountId]);
        delete syncTimeoutsRef.current[accountId];
        setSyncingAccounts((prev) => {
          const next = { ...prev };
          delete next[accountId];
          return next;
        });
        toast({
          title: "Sincronização concluída",
          description: `Conta ${current.mlNickname ?? accountId} sincronizada com sucesso.`,
        });
      }
    }
  }, [accounts]);

  const { mutate: deleteAccount, isPending: deleting } = useDeleteAccount({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
      },
    },
  });

  const { mutate: syncAccount } = useSyncAccount({
    mutation: {
      onError: (_err, variables) => {
        clearTimeout(syncTimeoutsRef.current[variables.id]);
        delete syncTimeoutsRef.current[variables.id];
        setSyncingAccounts((prev) => {
          const next = { ...prev };
          delete next[variables.id];
          return next;
        });
        toast({ variant: "destructive", title: "Erro ao sincronizar", description: "Não foi possível iniciar a sincronização." });
      },
    },
  });

  const handleSync = (account: Account) => {
    if (syncingAccounts[account.id] !== undefined) return;

    setSyncingAccounts((prev) => ({
      ...prev,
      [account.id]: account.lastSyncAt ?? null,
    }));

    syncAccount({ id: account.id });

    syncTimeoutsRef.current[account.id] = setTimeout(() => {
      setSyncingAccounts((prev) => {
        if (!(account.id in prev)) return prev;
        const next = { ...prev };
        delete next[account.id];
        return next;
      });
      toast({
        title: "Sincronização concluída",
        description: `A sincronização da conta ${account.mlNickname ?? account.id} pode ter finalizado em segundo plano.`,
      });
    }, SYNC_TIMEOUT_MS);
  };

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Integrações</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Gerencie suas integrações com marketplaces</p>
          </div>
          <ConnectButton />
        </div>

        <div className="bg-card border border-card-border rounded-xl p-4">
          <h3 className="text-foreground text-sm font-medium mb-3">Marketplaces disponíveis</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-800">Mercado Livre</span>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  Ativo
                </span>
              </div>
              <p className="text-xs text-amber-900/80 mt-1.5">Conexão via OAuth com sincronização automática de conta.</p>
            </div>

            <div className="rounded-lg border border-card-border bg-background p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">Shopee</span>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  Em breve
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">Integração em preparação para pedidos, estoque e anúncios.</p>
              <ConnectComingSoonButton marketplace="Shopee" />
            </div>

            <div className="rounded-lg border border-card-border bg-background p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">Amazon</span>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  Em breve
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">Conector planejado para catálogo, pedidos e status logístico.</p>
              <ConnectComingSoonButton marketplace="Amazon" />
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-24 bg-card border border-card-border rounded-xl animate-pulse" />
            ))}
          </div>
        ) : accounts.length === 0 ? (
          <div className="bg-card border border-card-border border-dashed rounded-xl py-16 text-center">
            <Store className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <h3 className="text-foreground font-medium mb-1">Nenhuma conta conectada</h3>
            <p className="text-muted-foreground text-sm mb-6 max-w-xs mx-auto">
              Conecte sua conta do Mercado Livre para começar a gerenciar seus anúncios e pedidos.
            </p>
            <ConnectButton />
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map((account) => {
              const isSyncing = account.id in syncingAccounts;
              return (
                <div
                  key={account.id}
                  className="bg-card border border-card-border rounded-xl p-4"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center flex-shrink-0">
                      <span className="text-amber-700 font-bold text-sm">ML</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-foreground font-medium text-sm">
                          {account.mlNickname ?? account.mlUserId ?? account.id}
                        </h3>
                        {account.isActive ? (
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                        )}
                        {isSyncing && (
                          <span className="text-[10px] text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded-md flex items-center gap-1">
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            Sincronizando...
                          </span>
                        )}
                      </div>
                      {account.mlEmail && (
                        <p className="text-muted-foreground text-xs mt-0.5">{account.mlEmail}</p>
                      )}
                      {account.lastSyncAt && (
                        <p className="text-muted-foreground/60 text-xs mt-0.5">
                          Última sincronização: {formatDateTime(account.lastSyncAt)}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSync(account)}
                        disabled={isSyncing}
                        className="h-8 text-xs gap-1.5 min-w-[110px]"
                      >
                        {isSyncing ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3 h-3" />
                        )}
                        {isSyncing ? "Sincronizando..." : "Sincronizar"}
                      </Button>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-red-200 text-red-500 hover:text-red-600 hover:bg-red-50 h-8 w-8 p-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remover conta</AlertDialogTitle>
                            <AlertDialogDescription>
                              Tem certeza que deseja remover a conta{" "}
                              <span className="text-foreground font-medium">{account.mlNickname}</span>?
                              Todos os dados sincronizados serão mantidos, mas a conta será desconectada.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>
                              Cancelar
                            </AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteAccount({ id: account.id })}
                              disabled={deleting}
                              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                            >
                              Remover
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>

                  <MpCredentialsPanel account={account} onUpdated={() => refetchAccounts()} />
                </div>
              );
            })}
          </div>
        )}

        <div className="bg-card border border-card-border rounded-xl p-4">
          <h3 className="text-foreground text-sm font-medium mb-2">Como funciona</h3>
          <div className="space-y-2 text-muted-foreground text-xs">
            <p>1. Clique em "Conectar conta ML" — você será redirecionado para o Mercado Livre</p>
            <p>2. Autorize o iHub a acessar sua conta</p>
            <p>3. Você será redirecionado de volta e a sincronização iniciará automaticamente</p>
            <p>4. Produtos, pedidos e perguntas serão importados para o iHub</p>
          </div>
        </div>

        <WebhookUrlCard />
      </div>
    </div>
  );
}
