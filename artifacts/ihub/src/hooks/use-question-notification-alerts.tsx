import { useEffect, useRef } from "react";
import type { NotificationListResponse } from "@workspace/api-client-react";
import { NotificationType } from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";
import { playNewQuestionAlertSound, primeQuestionAlertAudio } from "@/lib/play-question-alert";
import { ExternalLink } from "lucide-react";

/**
 * Quando chega uma notificação nova de pergunta (polling), toca alerta sonoro,
 * vibra em mobile (se suportado) e exibe toast com thumbnail + link do anúncio.
 */
export function useQuestionNotificationAlerts(data: NotificationListResponse | undefined): void {
  const primed = useRef(false);
  const seenIds = useRef(new Set<string>());

  useEffect(() => {
    const onPointer = () => primeQuestionAlertAudio();
    window.addEventListener("pointerdown", onPointer, { once: true });
    return () => window.removeEventListener("pointerdown", onPointer);
  }, []);

  useEffect(() => {
    const list = data?.data;
    if (!list) return;

    if (!primed.current) {
      list.forEach((n) => seenIds.current.add(n.id));
      primed.current = true;
      return;
    }

    for (const n of list) {
      if (seenIds.current.has(n.id)) continue;
      seenIds.current.add(n.id);

      if (n.type !== NotificationType.new_question) continue;

      playNewQuestionAlertSound();
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate([100, 40, 120]);
      }

      toast({
        title: "Nova pergunta no Mercado Livre",
        description: (
          <div className="space-y-2 pt-0.5">
            <div className="flex gap-2.5">
              {n.listingThumbnailUrl ? (
                <img
                  src={n.listingThumbnailUrl}
                  alt=""
                  className="size-14 rounded-md border border-border object-cover flex-shrink-0 bg-muted"
                />
              ) : null}
              <p className="text-sm leading-snug text-foreground/90">{n.message}</p>
            </div>
            {n.listingPermalink ? (
              <a
                href={n.listingPermalink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <ExternalLink className="size-3.5 flex-shrink-0" />
                Abrir anúncio no Mercado Livre
              </a>
            ) : null}
          </div>
        ),
        className:
          "border-primary/40 bg-background shadow-lg ring-2 ring-primary/20 data-[state=open]:animate-in",
        duration: 14_000,
      });
    }
  }, [data]);
}
