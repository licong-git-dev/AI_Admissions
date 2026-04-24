const TOKEN_KEY = 'admissions_token';
const USER_KEY = 'admissions_user';

export type AuthUser = {
  id: number;
  username: string;
  name: string;
  role: 'admin' | 'tenant_admin' | 'specialist' | 'student';
  tenant: string;
  phone?: string | null;
  wechatWorkUserId?: string | null;
  isActive: boolean;
};

export const getToken = (): string | null => {
  return localStorage.getItem(TOKEN_KEY);
};

export const setToken = (token: string): void => {
  localStorage.setItem(TOKEN_KEY, token);
};

export const getUser = (): AuthUser | null => {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
};

export const setUser = (user: AuthUser): void => {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};

export const clearAuth = (): void => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

export const authFetch = async (input: RequestInfo, init: RequestInit = {}): Promise<Response> => {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) {
    clearAuth();
    if (!window.location.pathname.startsWith('/assessment')) {
      window.dispatchEvent(new Event('auth-expired'));
    }
  }
  return response;
};

export const authJson = async <T>(input: RequestInfo, init: RequestInit = {}): Promise<T> => {
  const response = await authFetch(input, init);
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || '请求失败');
  }
  return payload.data as T;
};

const API_PATH_PATTERN = /^\/api(?:\/|$)/;

let patched = false;

export const installFetchAuthInterceptor = (): void => {
  if (patched) return;
  patched = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    let pathname = '';
    if (typeof input === 'string') {
      pathname = input.startsWith('http') ? new URL(input).pathname : input;
    } else if (input instanceof URL) {
      pathname = input.pathname;
    } else if (input instanceof Request) {
      pathname = new URL(input.url).pathname;
    }

    if (!API_PATH_PATTERN.test(pathname)) {
      return originalFetch(input, init);
    }

    const token = getToken();
    const headers = new Headers(init.headers);
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await originalFetch(input, { ...init, headers });
    if (response.status === 401) {
      clearAuth();
      if (!window.location.pathname.startsWith('/assessment')) {
        window.dispatchEvent(new Event('auth-expired'));
      }
    }
    return response;
  };
};
