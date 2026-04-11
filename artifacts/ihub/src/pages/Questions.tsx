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
import { MessageSquare, Send, ChevronDown, ChevronRight, ChevronLeft } from "lucide-react";
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
  unanswered: "bg-red-900/40 text-red-400 border-red-800/50",
  answered: "bg-emerald-900/40 text-emerald-400 border-emerald-800/50",
  closed_unanswered: "bg-[#122040] text-blue-400/50 border-[#1a3055]/50",
  under_review: "bg-amber-900/40 text-amber-400 border-amber-800/50",
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
    <div className="bg-[#0d1b2e] border border-[#1a3055]/60 rounded-xl overflow-hidden hover:border-blue-600/30 transition-colors">
      <button
        className="w-full flex items-start gap-3 px-4 py-3 text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex-shrink-0 mt-0.5">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-blue-400/60" />
          ) : (
            <ChevronRight className="w-4 h-4 text-blue-400/60" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-white text-sm font-medium truncate">{q.fromUserNickname ?? "Comprador"}</span>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md border ${STATUS_COLORS[q.status ?? ""] ?? "bg-[#122040] text-blue-300"}`}>
              {STATUS_LABELS[q.status ?? ""] ?? q.status}
            </span>
          </div>
          <p className="text-blue-200 text-sm leading-relaxed line-clamp-2">{q.text}</p>
          {q.mlItemId && (
            <p className="text-blue-400/70 text-xs mt-1 truncate">Item: {q.mlItemId}</p>
          )}
          <p className="text-blue-400/50 text-xs mt-1">{formatDateTime(q.createdAt)}</p>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pl-11 space-y-3 border-t border-[#1a3055]/40">
          {q.answerText && (
            <div className="mt-3 bg-emerald-900/20 border border-emerald-800/30 rounded-lg p-3">
              <p className="text-xs text-emerald-400 font-medium mb-1">Sua resposta</p>
              <p className="text-blue-100 text-sm">{q.answerText}</p>
            </div>
          )}

          {q.status === "unanswered" && (
            <div className="mt-3 space-y-2">
              <Textarea
                placeholder="Escreva sua resposta..."
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={3}
                className="bg-[#122040] border-[#1a3055]/70 text-white placeholder:text-blue-400/60 text-sm resize-none"
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
  const totalPages = pagination?.totalPages ?? 1;

  const { data: accountsData } = useListAccounts();
  const accounts = (accountsData as { data?: { id: string; mlNickname?: string | null }[] } | null)?.data ?? [];

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#080f1e]">
      <div className="sticky top-0 z-10 bg-[#080f1e] border-b border-[#1a3055]/60 flex-shrink-0 px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-white">Perguntas</h1>
            <p className="text-blue-400/70 text-xs">{pagination?.total ?? 0} perguntas encontradas</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-44 bg-[#122040] border-[#1a3055]/70 text-blue-200 text-xs h-7">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#0d1b2e] border-[#1a3055]/70">
              <SelectItem value="all" className="text-blue-200">Todos os status</SelectItem>
              <SelectItem value="unanswered" className="text-blue-200">Sem resposta</SelectItem>
              <SelectItem value="answered" className="text-blue-200">Respondidas</SelectItem>
              <SelectItem value="closed_unanswered" className="text-blue-200">Fechadas</SelectItem>
            </SelectContent>
          </Select>

          {accounts.length > 0 && (
            <Select value={accountId} onValueChange={(v) => { setAccountId(v); setPage(1); }}>
              <SelectTrigger className="w-36 bg-[#122040] border-[#1a3055]/70 text-blue-200 text-xs h-7">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0d1b2e] border-[#1a3055]/70">
                <SelectItem value="all" className="text-blue-200">Todas as contas</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id} className="text-blue-200">
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
              <div key={i} className="h-20 bg-[#0d1b2e] border border-[#1a3055]/60 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : questions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24">
            <MessageSquare className="w-10 h-10 text-blue-400/30 mb-3" />
            <p className="text-blue-400/60 text-sm">Nenhuma pergunta encontrada</p>
          </div>
        ) : (
          <div className="space-y-2">
            {questions.map((q) => <QuestionCard key={q.id} q={q} />)}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 py-2">
            <p className="text-blue-400/60 text-xs">Página {page} de {totalPages}</p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="w-7 h-7 rounded-lg border border-[#1a3055]/60 text-blue-300 hover:bg-[#122040] disabled:opacity-30 flex items-center justify-center transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="w-7 h-7 rounded-lg border border-[#1a3055]/60 text-blue-300 hover:bg-[#122040] disabled:opacity-30 flex items-center justify-center transition-colors"
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
