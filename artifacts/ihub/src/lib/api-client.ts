import { setBaseUrl, setDefaultCredentials, setAuthTokenGetter } from "@workspace/api-client-react";
import { installMockFetch } from "./mock-fetch";

const API_BASE_URL = import.meta.env.VITE_API_URL || "";
const TOKEN_KEY = "ihub_token";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function configureApiClient() {
  if (import.meta.env.VITE_DEMO_MODE === "true") {
    installMockFetch();
  }
  setBaseUrl(API_BASE_URL);
  setDefaultCredentials("include");
  setAuthTokenGetter(() => getStoredToken());
}
