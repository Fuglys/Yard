// API URL helper — prefix met Vite base path (/yard/ in productie, / in dev)
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}
