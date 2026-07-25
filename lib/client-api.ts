'use client';

// Thin fetch wrapper for the route handlers. Every endpoint answers either the
// payload or `{ error }` with a non-2xx status, so failure is always a throw
// with a message that is already written for the user in German.

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function post<T>(path: string, payload?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error || `Fehler (${res.status})`, res.status);
  return data as T;
}

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error || `Fehler (${res.status})`, res.status);
  return data as T;
}

export const store = {
  get: (k: string) => {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set: (k: string, v: string) => {
    try { localStorage.setItem(k, v); } catch { /* private mode */ }
  },
  del: (k: string) => {
    try { localStorage.removeItem(k); } catch { /* private mode */ }
  },
};
