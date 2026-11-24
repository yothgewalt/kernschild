// Tiny HTTP helpers shared by demo.mjs and loadtest.mjs (plain fetch, no deps).
export const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

export async function api(method, path, { body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body && { 'content-type': 'application/json' }),
      ...(token && { authorization: `Bearer ${token}` }),
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

export async function newUser(tag = 'user') {
  const email = `${tag}-${crypto.randomUUID().slice(0, 8)}@demo.local`;
  const password = 'secret123';
  await must('POST', '/auth/register', { body: { email, password } });
  const { token } = await must('POST', '/auth/login', { body: { email, password } });
  return { email, token };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
