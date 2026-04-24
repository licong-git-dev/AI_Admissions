const STUDENT_TOKEN_KEY = 'student_jwt';

export type StudentProfile = {
  phone: string;
  leadId: number | null;
  name: string;
  tenant: string;
  hasLead: boolean;
};

export const getStudentToken = (): string | null => sessionStorage.getItem(STUDENT_TOKEN_KEY);
export const setStudentToken = (token: string): void => sessionStorage.setItem(STUDENT_TOKEN_KEY, token);
export const clearStudentToken = (): void => sessionStorage.removeItem(STUDENT_TOKEN_KEY);

export const studentFetch = async (input: RequestInfo, init: RequestInit = {}): Promise<Response> => {
  const token = getStudentToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) {
    clearStudentToken();
  }
  return response;
};

export const studentJson = async <T>(input: RequestInfo, init: RequestInit = {}): Promise<T> => {
  const response = await studentFetch(input, init);
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || '请求失败');
  }
  return payload.data as T;
};
