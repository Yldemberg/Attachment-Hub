import { getDb } from "./db";
import { accountsTable } from "@workspace/db/schema";
import { eq, and, or, type SQL } from "drizzle-orm";
import { healInactiveAmazonAccounts } from "./amazon";

/**
 * Contas no escopo do usuário.
 * - Mercado Livre: só isActive (auth ML morta some do escopo).
 * - Amazon: qualquer conta ainda no banco — desconexão é DELETE em Integrações;
 *   falha de refresh NÃO remove a loja da listagem/produtos/estoque.
 */
function linkedAccountCondition(): SQL {
  return or(eq(accountsTable.isActive, true), eq(accountsTable.platform, "amazon"))!;
}

export async function getUserAccountIds(userId: string, filterAccountId?: string): Promise<string[]> {
  // Reativa Amazon marcada inativa por legado/bug de refresh (idempotente).
  await healInactiveAmazonAccounts(userId);

  const db = getDb();
  const conditions = [eq(accountsTable.userId, userId), linkedAccountCondition()];
  if (filterAccountId) conditions.push(eq(accountsTable.id, filterAccountId));
  const accounts = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(and(...conditions));
  return accounts.map((a) => a.id);
}
