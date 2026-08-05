export async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", ...opts });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message ?? "Terjadi kesalahan.");
  return d;
}

function withBody(method: string, body?: unknown): RequestInit {
  return {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  };
}

export const api = {
  get:    async <T = unknown>(url: string) =>                  ({ data: (await apiFetch(url)) as T }),
  post:   async <T = unknown>(url: string, body?: unknown) =>  ({ data: (await apiFetch(url, withBody("POST",  body))) as T }),
  put:    async <T = unknown>(url: string, body?: unknown) =>  ({ data: (await apiFetch(url, withBody("PUT",   body))) as T }),
  patch:  async <T = unknown>(url: string, body?: unknown) =>  ({ data: (await apiFetch(url, withBody("PATCH", body))) as T }),
  delete: async <T = unknown>(url: string) =>                  ({ data: (await apiFetch(url, { method: "DELETE", credentials: "include" })) as T }),
};
