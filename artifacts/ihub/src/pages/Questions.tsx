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
import { MessageSquare, Send, ChevronDown, ChevronRight } from "lucide-react";
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
  closed_unanswered: "Fechada sem resposta",
  under_review: "Em revisao",
};

const STATUS_COLORS: Record<string, string> = {
  unanswered: "bg-red-900/40 text-red-400 border-red-800/50",
  answered: "bg-emerald-900/40 text-emerald-400 border-emerald-800/50",
  closed_unanswered: "bg-slate-800 text-slate-500 border-slate-700",
  under_review: "bg-amber-900/40 text-amber-400 border-amber-800/50",
};

function QuestionRow({ q }: { q: Question }) {
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
    <div className="border-b border-slate-800/50 last:border-0">
      <button
        className="w-full flex items-start gap-3 px-4 py-3 hover:bg-slate-800/30 transition-colors text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex-shrink-0 mt-0.5">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-500" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-slate-200 text-sm font-medium truncate">{q.fromUserNickname ?? "Comprador"}</span>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${STATUS_COLORS[q.status ?? ""] ?? "bg-slate-800 text-slate-500"}`}>
              {STATUS_LABELS[q.status ?? ""] ?? q.status}
            </span>
          </div>
          <p className="text-slate-300 text-sm leading-relaxed line-clamp-2">{q.text}</p>
          {q.mlItemId && (
            <p className="text-slate-500 text-xs mt-1 truncate">Item: {q.mlItemId}</p>
          )}
          <p className="text-slate-600 text-xs mt-1">{formatDateTime(q.createdAt)}</p>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pl-11 space-y-3">
          {q.answerText && (
            <div className="bg-emerald-900/20 border border-emerald-800/30 rounded-lg p-3">
              <p className="text-xs text-emerald-500 font-medium mb-1">Sua resposta</p>
              <p className="text-slate-200 text-sm">{q.answerText}</p>
            </div>
          )}

          {q.status === "unanswered" && (
            <div className="space-y-2">
              <Textarea
                placeholder="Escreva sua resposta..."
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={3}
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 text-sm resize-none"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => sendAnswer({ id: q.id, data: { text: answer } })}
                  disabled={!answer.trim() || isPending}
                  className="bg-blue-600 hover:bg-blue-500 text-white h-7 text-xs gap-1.5"
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

  const { data: accountsData } = useListAccounts();
  const accounts = (accountsData as { data?: { id: string; mlNickname?: string | null }[] } | null)?.data ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Perguntas</h1>
          <p className="text-slate-400 text-sm mt-0.5">{pagination?.total ?? 0} perguntas encontradas</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-44 bg-slate-800 border-slate-700 text-slate-300 text-sm h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-700">
            <SelectItem value="all" className="text-slate-300">Todos os status</SelectItem>
            <SelectItem value="unanswered" className="text-slate-300">Sem resposta</SelectItem>
            <SelectItem value="answered" className="text-slate-300">Respondidas</SelectItem>
            <SelectItem value="closed_unanswered" className="text-slate-300">Fechadas</SelectItem>
          </SelectContent>
        </Select>

        {accounts.length > 0 && (
          <Select value={accountId} onValueChange={(v) => { setAccountId(v); setPage(1); }}>
            <SelectTrigger className="w-40 bg-slate-800 border-slate-700 text-slate-300 text-sm h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700">
              <SelectItem value="all" className="text-slate-300">Todas as contas</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id} className="text-slate-300">
                  {a.mlNickname ?? a.id.slice(0, 8)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="px-4 py-4 border-b border-slate-800/50 animate-pulse">
              <div className="h-4 bg-slate-800 rounded w-3/4 mb-2" />
              <div className="h-3 bg-slate-800 rounded w-1/2" />
            </div>
          ))
        ) : questions.length === 0 ? (
          <div className="py-12 text-center">
            <MessageSquare className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-slate-500 text-sm">Nenhuma pergunta encontrada</p>
          </div>
        ) : (
          questions.map((q) => <QuestionRow key={q.id} q={q} />)
        )}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-slate-500 text-xs">Pagina {page} de {pagination.totalPages}</p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="h-7 px-2 text-xs border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800"
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= pagination.totalPages}
              className="h-7 px-2 text-xs border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800"
            >
              Proxima
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
