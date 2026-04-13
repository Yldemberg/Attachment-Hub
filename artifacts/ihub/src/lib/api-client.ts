import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import { getStoredToken } from "./auth-storage";

const API_BASE_URL = import.meta.env.VITE_API_URL || "";

export function configureApiClient() {
  setBaseUrl(API_BASE_URL);
  setAuthTokenGetter(getStoredToken);
}

export function updateApiToken(_token: string | null) {
  // no-op: token getter reads from localStorage directly on every request
}
