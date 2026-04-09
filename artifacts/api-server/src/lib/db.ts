import { db } from "@workspace/db";

export { db };
export function getDb() {
  return db;
}
