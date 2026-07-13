const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4447";
const TOKEN_KEY = "ka.token";

// Broadcast so the login gate can react when a request finds the token invalid.
export const AUTH_EXPIRED_EVENT = "ka:auth-expired";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

function setToken(token: string) {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function logout() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

export async function login(password: string): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    let detail = "Login failed";
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  const { token } = await res.json();
  setToken(token);
}

export function authHeaders(base: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  return token ? { ...base, Authorization: `Bearer ${token}` } : base;
}

// fetch wrapper that attaches the bearer token and logs out on a 401.
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = authHeaders(init.headers as Record<string, string> | undefined);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) {
    logout();
    throw new Error("Session expired");
  }
  return res;
}
