import { useState } from "react";
import {
  useListQuestions,
  useListAccounts,
  useAnswerQuestion,
  getListQuestionsQueryKey,
  getGetQuestionQueryKey,
  ListQuestionsStatus,
} from "@workspace/api-client-react";
import type { Question as ApiQuestion } from "@workspace/api-client-react";
import { formatDateTime } from "@/lib/utils";
import { MessageSquare, Send, ChevronDown, ChevronRight, ChevronLeft, ExternalLink, Package } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

export default function Questions() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("unanswered");
  const [accountId, setAccountId] = useState("all");

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
  const accounts = (accountsData as { data?: { id: string; mlNickname?: string | null }[] } | null)?.data ?? [];

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      <div className="sticky top-0 z-10 bg-background border-b border-border flex-shrink-0 px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-foreground">Perguntas</h1>
            <p className="text-muted-foreground text-xs">{pagination?.total ?? 0} perguntas encontradas</p>
          </div>
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

          {accounts.length > 0 && (
            <Select value={accountId} onValueChange={(v) => { setAccountId(v); setPage(1); }}>
              <SelectTrigger className="w-36 text-xs h-7">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as contas</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.mlNickname ?? a.id.slice(0, 8)}
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
    </div>
  );
}
