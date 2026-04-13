import { SignJWT } from "jose";

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? "changeme-set-supabase-jwt-secret";
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function signUserToken(userId: string, email: string): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}
