import { useEffect, useMemo, useState } from "react";
import {
  useListQuestions,
  useListAccounts,
  useAnswerQuestion,
  useUpdateFullSettings,
  getFullSettings,
  getListQuestionsQueryKey,
  getGetQuestionQueryKey,
  getGetFullSettingsQueryKey,
  ListQuestionsStatus,
} from "@workspace/api-client-react";
import type { Question as ApiQuestion } from "@workspace/api-client-react";
import { formatDateTime } from "@/lib/utils";
import {
  MessageSquare,
  Send,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
  Package,
  Settings2,
  Loader2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { MlAccountMultiSelect } from "@/pages/products/components/MlAccountMultiSelect";

type Question = ApiQuestion;

const STATUS_LABELS: Record<string, string> = {
  unanswered: "Sem resposta",
  answered: "Respondida",
  closed_unanswered: "Fechada",
  under_review: "Em revisão",
};

const STATUS_COLORS: Record<string, string> = {
  unanswered: "bg-red-50 text-red-600 border-red-200",
  answered: "bg-emerald-50 text-emerald-700 border-emerald-200",
  closed_unanswered: "bg-slate-100 text-slate-500 border-slate-200",
  under_review: "bg-amber-50 text-amber-700 border-amber-200",
};

function QuestionCard({ q }: { q: Question }) {
  const [expanded, setExpanded] = useState(q.status === "unanswered");
  const [answer, setAnswer] = useState("");
  const queryClient = useQueryClient();

  const { mutate: sendAnswer, isPending } = useAnswerQuestion({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListQuestionsQueryKey({}) });
        queryClient.invalidateQueries({ queryKey: getGetQuestionQueryKey(q.id) });
        setAnswer("");
      },
    },
  });

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden hover:border-primary/30 transition-colors">
      <button
        className="w-full flex items-start gap-3 px-4 py-3 text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex-shrink-0 mt-0.5">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
        {q.listingThumbnailUrl ? (
          <img
            src={q.listingThumbnailUrl}
            alt=""
            className="size-14 rounded-lg border border-border object-cover flex-shrink-0 bg-muted"
          />
        ) : (
          <div className="size-14 rounded-lg border border-border bg-muted flex items-center justify-center flex-shrink-0">
            <Package className="w-6 h-6 text-muted-foreground/50" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-foreground text-sm font-medium truncate">{q.fromUserNickname ?? "Comprador"}</span>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md border ${STATUS_COLORS[q.status ?? ""] ?? "bg-slate-100 text-slate-600"}`}>
              {STATUS_LABELS[q.status ?? ""] ?? q.status}
            </span>
          </div>
          <p className="text-foreground/80 text-sm leading-relaxed line-clamp-2">{q.text}</p>
          <div className="flex flex-col gap-1 mt-1 min-w-0">
            {q.mlItemId && (
              <p className="text-muted-foreground text-[10px] font-mono truncate">MLB {q.mlItemId}</p>
            )}
            {q.listingPermalink ? (
              <a
                href={q.listingPermalink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary font-medium hover:underline w-fit"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-3 h-3 flex-shrink-0" />
                Ver anúncio no Mercado Livre
              </a>
            ) : null}
          </div>
          <p className="text-muted-foreground/60 text-xs mt-1">{formatDateTime(q.createdAt)}</p>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border">
          {q.answerText && (
            <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <p className="text-xs text-emerald-700 font-medium mb-1">Sua resposta</p>
              <p className="text-foreground text-sm">{q.answerText}</p>
            </div>
          )}

          {q.status === "unanswered" && (
            <div className="mt-3 space-y-2">
              <Textarea
                placeholder="Escreva sua resposta..."
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={3}
                className="text-sm resize-none"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => sendAnswer({ id: q.id, data: { text: answer } })}
                  disabled={!answer.trim() || isPending}
                  className="h-7 text-xs gap-1.5"
                >
                  <Send className="w-3 h-3" />
                  {isPending ? "Enviando..." : "Responder"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function mlAccountLabel(a: {
  id: string;
  mlNickname?: string | null;
  mlUserId?: string | null;
}): string {
  return a.mlNickname ?? a.mlUserId ?? a.id.slice(0, 8);
}

export default function Questions() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("unanswered");
  const [accountId, setAccountId] = useState("all");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [draftPhone, setDraftPhone] = useState("");
  const [draftAlertQuestions, setDraftAlertQuestions] = useState(true);
  const [saving, setSaving] = useState(false);

  const queryClient = useQueryClient();

  const params = {
    page,
    limit: 20,
    ...(status !== "all" ? { status: status as (typeof ListQuestionsStatus)[keyof typeof ListQuestionsStatus] } : {}),
    ...(accountId !== "all" ? { account_id: accountId } : {}),
  };

  const { data, isLoading } = useListQuestions(params, {
    query: { queryKey: getListQuestionsQueryKey(params) },
  });
  const questions: Question[] = data?.data ?? [];
  const pagination = (data as { pagination?: { total: number; totalPages: number } } | null)?.pagination;
  const totalPages = pagination?.totalPages ?? 1;

  const { data: accountsData } = useListAccounts();
  const mlAccounts = useMemo(
    () =>
      (accountsData?.data ?? []).filter(
        (a) => (a.platform ?? "mercadolivre") === "mercadolivre" && a.isActive !== false,
      ),
    [accountsData],
  );

  const updateSettings = useUpdateFullSettings();

  useEffect(() => {
    if (!settingsOpen || mlAccounts.length === 0) return;

    let cancelled = false;
    setSettingsLoading(true);

    void (async () => {
      try {
        const rows = await Promise.all(
          mlAccounts.map(async (a) => {
            const settings = await getFullSettings({ account_id: a.id });
            return { accountId: a.id, settings };
          }),
        );
        if (cancelled) return;

        const enabledIds = rows
          .filter((r) => r.settings.alertQuestions)
          .map((r) => r.accountId);

        const phoneFromEnabled =
          rows.find((r) => r.settings.alertQuestions && r.settings.whatsappPhone)?.settings
            .whatsappPhone ??
          rows.find((r) => r.settings.whatsappPhone)?.settings.whatsappPhone ??
          "";

        const preferred =
          accountId !== "all" && mlAccounts.some((a) => a.id === accountId)
            ? [accountId]
            : enabledIds.length > 0
              ? enabledIds
              : mlAccounts.map((a) => a.id);

        setSelectedAccountIds(preferred);
        setDraftPhone(phoneFromEnabled);
        setDraftAlertQuestions(enabledIds.length > 0 || preferred.length > 0);
      } catch {
        if (!cancelled) {
          toast({
            variant: "destructive",
            title: "Falha ao carregar WhatsApp",
            description: "Não foi possível ler as configurações das contas ML.",
          });
        }
      } finally {
        if (!cancelled) setSettingsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [settingsOpen, mlAccounts, accountId]);

  const onSaveWhatsApp = async () => {
    if (mlAccounts.length === 0) return;

    const phone = draftPhone.trim().replace(/\D/g, "");
    const notify = draftAlertQuestions && selectedAccountIds.length > 0;
    if (notify && phone.length < 10) {
      toast({
        variant: "destructive",
        title: "Telefone inválido",
        description: "Informe DDI+DDD+número (ex.: 5511999999999).",
      });
      return;
    }
    if (draftAlertQuestions && selectedAccountIds.length === 0) {
      toast({
        variant: "destructive",
        title: "Selecione contas",
        description: "Escolha ao menos uma conta ML ou desative as notificações.",
      });
      return;
    }

    const selected = new Set(selectedAccountIds);
    setSaving(true);
    try {
      await Promise.all(
        mlAccounts.map((a) => {
          const isSelected = selected.has(a.id);
          if (notify && isSelected) {
            return updateSettings.mutateAsync({
              data: {
                accountId: a.id,
                whatsappPhone: phone,
                alertQuestions: true,
              },
            });
          }
          return updateSettings.mutateAsync({
            data: {
              accountId: a.id,
              alertQuestions: false,
            },
          });
        }),
      );

      const count = notify ? selectedAccountIds.length : 0;
      toast({
        title: "WhatsApp de perguntas salvo",
        description: notify
          ? `${count} conta(s) ML receberão alertas no mesmo workflow N8N.`
          : "Notificações de perguntas desativadas em todas as contas.",
      });
      setSettingsOpen(false);
      for (const a of mlAccounts) {
        void queryClient.invalidateQueries({
          queryKey: getGetFullSettingsQueryKey({ account_id: a.id }),
        });
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: "Verifique o telefone e as contas selecionadas.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      <div className="sticky top-0 z-10 bg-background border-b border-border flex-shrink-0 px-4 py-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-bold text-foreground">Perguntas</h1>
            <p className="text-muted-foreground text-xs">{pagination?.total ?? 0} perguntas encontradas</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => setSettingsOpen(true)}
            disabled={mlAccounts.length === 0}
          >
            <Settings2 className="w-3.5 h-3.5" />
            WhatsApp
          </Button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-44 text-xs h-7">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="unanswered">Sem resposta</SelectItem>
              <SelectItem value="answered">Respondidas</SelectItem>
              <SelectItem value="closed_unanswered">Fechadas</SelectItem>
            </SelectContent>
          </Select>

          {mlAccounts.length > 0 && (
            <Select value={accountId} onValueChange={(v) => { setAccountId(v); setPage(1); }}>
              <SelectTrigger className="w-44 text-xs h-7">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as contas</SelectItem>
                {mlAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {mlAccountLabel(a)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-20 bg-card border border-card-border rounded-xl animate-pulse" />
            ))}
          </div>
        ) : questions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24">
            <MessageSquare className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground text-sm">Nenhuma pergunta encontrada</p>
          </div>
        ) : (
          <div className="space-y-2">
            {questions.map((q) => <QuestionCard key={q.id} q={q} />)}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 py-2">
            <p className="text-muted-foreground text-xs">Página {page} de {totalPages}</p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="w-7 h-7 rounded-lg border border-border text-muted-foreground hover:bg-accent disabled:opacity-30 flex items-center justify-center transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="w-7 h-7 rounded-lg border border-border text-muted-foreground hover:bg-accent disabled:opacity-30 flex items-center justify-center transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>WhatsApp · Perguntas</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {settingsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" />
                Carregando contas ML…
              </div>
            ) : (
              <>
                <MlAccountMultiSelect
                  accounts={mlAccounts}
                  selectedIds={selectedAccountIds}
                  onChange={setSelectedAccountIds}
                  disabled={!draftAlertQuestions || saving}
                  hint="Contas do Mercado Livre que enviam alerta no WhatsApp quando chegar pergunta."
                  multiSelectedHint="contas selecionadas — o mesmo número será aplicado a todas."
                />

                <div className="space-y-1.5">
                  <Label>WhatsApp (DDI+DDD+número)</Label>
                  <Input
                    placeholder="5511999999999"
                    value={draftPhone}
                    onChange={(e) => setDraftPhone(e.target.value)}
                    disabled={!draftAlertQuestions || saving}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Mesmo telefone e workflow N8N + Evolution da Gestão Full.
                  </p>
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draftAlertQuestions}
                    onChange={(e) => setDraftAlertQuestions(e.target.checked)}
                    disabled={saving}
                  />
                  Notificar novas perguntas no WhatsApp
                </label>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              onClick={() => void onSaveWhatsApp()}
              disabled={saving || settingsLoading || mlAccounts.length === 0}
            >
              {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
