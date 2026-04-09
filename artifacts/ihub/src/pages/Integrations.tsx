import {
  useListAccounts,
  useGetConnectUrl,
  useDeleteAccount,
  useSyncAccount,
  getListAccountsQueryKey,
} from "@workspace/api-client-react";
import { formatDateTime } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Plug, Plus, RefreshCw, Trash2, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { useState } from "react";

interface Account {
  id: string;
  mlNickname?: string | null;
  mlEmail?: string | null;
  mlUserId?: string | null;
  isActive?: boolean | null;
  lastSyncAt?: string | null;
}

function ConnectButton() {
  const [loading, setLoading] = useState(false);
  const { data: connectUrl } = useGetConnectUrl();
  const url = (connectUrl as { url?: string } | null)?.url;

  const handleConnect = () => {
    if (!url) return;
    setLoading(true);
    window.location.href = url;
  };

  return (
    <Button
      onClick={handleConnect}
      disabled={loading || !url}
      className="bg-blue-600 hover:bg-blue-500 text-white gap-2"
    >
      <Plus className="w-4 h-4" />
      Conectar conta ML
    </Button>
  );
}

export default function Integrations() {
  const queryClient = useQueryClient();

  const { data: accountsData, isLoading } = useListAccounts();
  const accounts: Account[] = (accountsData as { data?: Account[] } | null)?.data ?? [];

  const { mutate: deleteAccount, isPending: deleting } = useDeleteAccount({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
      },
    },
  });

  const { mutate: syncAccount } = useSyncAccount({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
      },
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Integracoes</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Gerencie suas contas do Mercado Livre
          </p>
        </div>
        <ConnectButton />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 bg-slate-900 border border-slate-800 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 border-dashed rounded-lg py-16 text-center">
          <Plug className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h3 className="text-slate-300 font-medium mb-1">Nenhuma conta conectada</h3>
          <p className="text-slate-500 text-sm mb-6 max-w-xs mx-auto">
            Conecte sua conta do Mercado Livre para comecar a gerenciar seus anuncios e pedidos.
          </p>
          <ConnectButton />
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex items-center gap-4"
            >
              <div className="w-10 h-10 rounded-lg bg-amber-900/40 border border-amber-800/30 flex items-center justify-center flex-shrink-0">
                <span className="text-amber-400 font-bold text-sm">ML</span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-white font-medium text-sm">
                    {account.mlNickname ?? account.mlUserId ?? account.id}
                  </h3>
                  {account.isActive ? (
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                  )}
                </div>
                {account.mlEmail && (
                  <p className="text-slate-400 text-xs mt-0.5">{account.mlEmail}</p>
                )}
                {account.lastSyncAt && (
                  <p className="text-slate-500 text-xs mt-0.5">
                    Ultima sincronizacao: {formatDateTime(account.lastSyncAt)}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => syncAccount({ id: account.id })}
                  className="border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 h-8 text-xs gap-1.5"
                >
                  <RefreshCw className="w-3 h-3" />
                  Sincronizar
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-red-900/50 text-red-400 hover:text-red-300 hover:bg-red-900/20 h-8 w-8 p-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-slate-900 border-slate-700">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-white">Remover conta</AlertDialogTitle>
                      <AlertDialogDescription className="text-slate-400">
                        Tem certeza que deseja remover a conta{" "}
                        <span className="text-white font-medium">{account.mlNickname}</span>?
                        Todos os dados sincronizados serao mantidos, mas a conta sera desconectada.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800">
                        Cancelar
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteAccount({ id: account.id })}
                        disabled={deleting}
                        className="bg-red-600 hover:bg-red-500 text-white"
                      >
                        Remover
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-white text-sm font-medium mb-2">Como funciona</h3>
        <div className="space-y-2 text-slate-400 text-xs">
          <p>1. Clique em "Conectar conta ML" — voce sera redirecionado para o Mercado Livre</p>
          <p>2. Autorize o iHub a acessar sua conta</p>
          <p>3. Voce sera redirecionado de volta e a sincronizacao iniciara automaticamente</p>
          <p>4. Produtos, pedidos e perguntas serao importados para o iHub</p>
        </div>
      </div>
    </div>
  );
}
