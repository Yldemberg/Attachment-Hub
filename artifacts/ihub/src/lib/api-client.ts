import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";

const API_BASE_URL = import.meta.env.VITE_API_URL || "";

export function configureApiClient() {
  setBaseUrl(API_BASE_URL);
  setAuthTokenGetter(null);
}

export function updateApiToken(token: string | null) {
  setAuthTokenGetter(token ? () => token : null);
}
