const NANGO_BASE = 'https://nango.projectsites.dev';

export interface NangoConnection {
  id: string;
  provider: string;
  created_at: string;
  updated_at: string;
}

export async function nangoApi(
  secretKey: string,
  path: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${NANGO_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Nango API ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}
