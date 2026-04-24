import type { Request, Response, NextFunction } from 'express';
import { verifyJwt, type JwtPayload } from '../services/jwt';

export type AuthedRequest = Request & { user?: JwtPayload };

export const requireAuth = (req: AuthedRequest, res: Response, next: NextFunction): void => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';

  if (!token) {
    res.status(401).json({ success: false, data: null, error: '缺少登录凭证' });
    return;
  }

  const payload = verifyJwt(token);
  if (!payload) {
    res.status(401).json({ success: false, data: null, error: '登录凭证无效或已过期' });
    return;
  }

  req.user = payload;
  next();
};

export const requireRole = (roles: Array<JwtPayload['role']>) =>
  (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, data: null, error: '缺少登录凭证' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, data: null, error: '权限不足' });
      return;
    }

    next();
  };

export const optionalAuth = (req: AuthedRequest, _res: Response, next: NextFunction): void => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (token) {
    const payload = verifyJwt(token);
    if (payload) {
      req.user = payload;
    }
  }
  next();
};
