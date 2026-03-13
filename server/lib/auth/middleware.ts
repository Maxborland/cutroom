import type { NextFunction, Request, Response } from 'express';
import { sendApiError } from '../api-error.js';
import { getSessionTokenFromRequest } from './session.js';
import { type AuthRepository, type AuthSessionRecord, type AuthUser, toAuthUser } from './repository.js';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        user: AuthUser;
        session: AuthSessionRecord;
      };
    }
  }
}

export function createAuthSessionMiddleware(authRepository: AuthRepository) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const sessionToken = getSessionTokenFromRequest(req);
    if (!sessionToken) {
      next();
      return;
    }

    try {
      const session = await authRepository.findSessionByToken(sessionToken);
      if (!session) {
        next();
        return;
      }

      const user = await authRepository.findUserById(session.userId);
      if (!user) {
        await authRepository.deleteSession(sessionToken);
        next();
        return;
      }

      req.auth = {
        user: toAuthUser(user),
        session,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAuthenticatedUser(req: Request, res: Response, next: NextFunction): void {
  if (req.auth?.user) {
    next();
    return;
  }

  sendApiError(res, 401, 'Authentication required', 'AUTH_REQUIRED');
}
