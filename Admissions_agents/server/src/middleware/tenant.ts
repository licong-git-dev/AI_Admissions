import type { AuthedRequest } from './auth';

export type TenantScope = {
  tenant: string;
  isPlatformAdmin: boolean;
};

export const getTenantScope = (req: AuthedRequest): TenantScope => {
  const user = req.user;
  if (!user) {
    return { tenant: 'default', isPlatformAdmin: false };
  }

  return {
    tenant: user.tenant,
    isPlatformAdmin: user.role === 'admin' && user.tenant === 'platform',
  };
};

export const buildTenantWhere = (
  scope: TenantScope,
  tableAlias: string = ''
): { clause: string; params: (string | number)[] } => {
  if (scope.isPlatformAdmin) {
    return { clause: '', params: [] };
  }
  const prefix = tableAlias ? `${tableAlias}.` : '';
  return {
    clause: `${prefix}tenant = ?`,
    params: [scope.tenant],
  };
};

export const resolveTenantForWrite = (scope: TenantScope, requested?: string): string => {
  if (scope.isPlatformAdmin && requested) {
    return requested;
  }
  return scope.tenant;
};
