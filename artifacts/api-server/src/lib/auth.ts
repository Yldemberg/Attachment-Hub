import { Request, Response, NextFunction } from "express";
import { jwtVerify } from "jose";
import { logger } from "./logger";

export interface AuthUser {
  id: string;
  email?: string;
  role?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? "changeme-set-supabase-jwt-secret";

async function verifyJwt(token: string): Promise<AuthUser> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
  return {
    id: payload.sub as string,
    email: payload.email as string | undefined,
    role: payload.role as string | undefined,
  };
}

function extractToken(req: Request): string | null {
  // 1. httpOnly cookie (preferred in production — not touchable by JS or proxies)
  const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.ihub_token;
  if (cookie) return cookie;

  // 2. Authorization: Bearer <token> (fallback for API clients / dev)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  return null;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractToken(req);

  if (!token) {
    logger.warn({ url: req.url }, "401: no auth token in cookie or Authorization header");
    res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Missing or invalid session" },
    });
    return;
  }

  try {
    const user = await verifyJwt(token);
    req.user = user;
    next();
  } catch (err) {
    logger.warn({ err, url: req.url }, "401: JWT verification failed");
    res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Invalid or expired token" },
    });
  }
}

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractToken(req);
  if (token) {
    try {
      req.user = await verifyJwt(token);
    } catch {
      // Ignore — user stays unauthenticated
    }
  }
  next();
}
