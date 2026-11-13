import { API_URL } from "@/lib/config";

/** Typed API error: `code` drives UI behaviour, `message` is already human-readable. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export const isApiError = (e: unknown, code?: string): e is ApiError => e instanceof ApiError && (!code || e.code === code);

const TOKEN_KEY = "builderos.session";
let memoryToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;

/** The session token is the only credential the browser holds. It never decides access: the server does. */
export const session = {
  get(): string | null {
    if (memoryToken) return memoryToken;
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      const { token, expiresAt } = JSON.parse(raw) as { token: string; expiresAt: string };
      if (new Date(expiresAt).getTime() < Date.now()) {
        window.localStorage.removeItem(TOKEN_KEY);
        return null;
      }
      memoryToken = token;
      return token;
    } catch {
      return null;
    }
  },
  set(token: string, expiresAt: string) {
    memoryToken = token;
    try {
      window.localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt }));
    } catch {
      /* private mode: memory only */
    }
  },
  clear() {
    memoryToken = null;
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
  onUnauthenticated(fn: () => void) {
    onUnauthenticated = fn;
  },
};

export const newIdempotencyKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

type Opts = { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; query?: Record<string, string | number | boolean | null | undefined>; idempotencyKey?: string; auth?: boolean; signal?: AbortSignal; raw?: boolean };

export function apiUrl(path: string, query?: Opts["query"]) {
  const url = new URL(API_URL + path);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  return url.toString();
}

export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {};
  const token = opts.auth === false ? null : session.get();
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  // Every write carries an Idempotency-Key; callers pass a stable one to make a retried click safe.
  if (method !== "GET") headers["idempotency-key"] = opts.idempotencyKey ?? newIdempotencyKey();

  let res: Response;
  try {
    res = await fetch(apiUrl(path, opts.query), { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "network", "Can't reach BuilderOS. Check your connection and try again.");
  }
  if (opts.raw && res.ok) return (await res.text()) as T;
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const code = json?.code ?? json?.error ?? (res.status === 401 ? "unauthenticated" : "unknown");
    const err = new ApiError(res.status, code, json?.message ?? `Request failed (${res.status}).`, json?.details ?? {});
    if (res.status === 401 && opts.auth !== false && code !== "bad_privy_token") {
      session.clear();
      onUnauthenticated?.();
    }
    throw err;
  }
  return json as T;
}
