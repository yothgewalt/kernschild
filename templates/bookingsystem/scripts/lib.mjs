// Tiny HTTP helpers shared by demo.mjs, loadtest.mjs and check.mjs (plain fetch, no deps).
export const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

export async function api(method, path, { body, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body && { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

export async function must(method, path, opts) {
  const res = await api(method, path, opts);
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

// A customer is just an email and a name; there is no sign-up.
export function newCustomer(tag = 'customer') {
  const id = crypto.randomUUID().slice(0, 8);
  return { email: `${tag}-${id}@demo.local`, name: `Demo ${tag} ${id}` };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
