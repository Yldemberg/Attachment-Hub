import React, { createContext, useContext, useEffect, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { configureApiClient, updateApiToken } from "./api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  getListNotificationsQueryKey,
  getListQuestionsQueryKey,
  getListOrdersQueryKey,
  getListProductsQueryKey,
  getGetLowStockProductsQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetSalesChartQueryKey,
  getListAccountsQueryKey,
} from "@workspace/api-client-react";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    configureApiClient();

    supabase.auth.getSession().then(({ data: { session } }) => {
      updateApiToken(session?.access_token ?? null);
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      updateApiToken(session?.access_token ?? null);
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("realtime-notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const type = (payload.new as { type?: string }).type;

          queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });

          if (type === "new_question") {
            queryClient.invalidateQueries({ queryKey: getListQuestionsQueryKey() });
          } else if (type === "new_order" || type === "order_update") {
            queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetSalesChartQueryKey() });
          } else if (type === "low_stock") {
            queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetLowStockProductsQueryKey() });
          } else if (type === "sync_complete") {
            queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetLowStockProductsQueryKey() });
            queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
            queryClient.invalidateQueries({ queryKey: getListQuestionsQueryKey() });
            queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetSalesChartQueryKey() });
          }

          toast({
            title: (payload.new as { title?: string }).title || "Nova notificação",
            description: (payload.new as { message?: string }).message || "",
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient, toast]);

  const signOut = async () => {
    updateApiToken(null);
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
