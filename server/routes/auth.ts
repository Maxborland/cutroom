import { Router, type Request, type Response } from 'express';
import { sendApiError } from '../lib/api-error.js';
import { hashPassword, validatePassword, verifyPassword } from '../lib/auth/passwords.js';
import { AuthRepositoryError, type AuthRepository, toAuthUser } from '../lib/auth/repository.js';
import {
  SESSION_TTL_MS,
  clearSessionCookie,
  getSessionTokenFromRequest,
  setSessionCookie,
} from '../lib/auth/session.js';

function sendRepositoryError(res: Response, error: AuthRepositoryError): void {
  switch (error.code) {
    case 'INVITE_NOT_FOUND':
      sendApiError(res, 404, error.message, error.code);
      return;
    case 'INVITE_ALREADY_ACCEPTED':
    case 'USER_ALREADY_EXISTS':
    case 'BOOTSTRAP_INVITE_CLOSED':
      sendApiError(res, 409, error.message, error.code);
      return;
    default:
      sendApiError(res, 400, error.message, error.code);
  }
}

export function createAuthRoutes(authRepository: AuthRepository): Router {
  const router = Router();

  router.post('/login', async (req: Request, res: Response) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      if (!email || !password) {
        sendApiError(res, 400, 'Email and password are required', 'LOGIN_FIELDS_REQUIRED');
        return;
      }

      const user = await authRepository.findUserByEmail(email);
      if (!user) {
        sendApiError(res, 401, 'Invalid email or password', 'INVALID_CREDENTIALS');
        return;
      }

      const isValid = await verifyPassword(password, user.passwordHash);
      if (!isValid) {
        sendApiError(res, 401, 'Invalid email or password', 'INVALID_CREDENTIALS');
        return;
      }

      const session = await authRepository.createSession(user.id, new Date(Date.now() + SESSION_TTL_MS));
      setSessionCookie(req, res, session.token);
      res.json({ user: toAuthUser(user) });
    } catch (error) {
      console.error('Failed to log in:', error);
      sendApiError(res, 500, 'Failed to log in', 'LOGIN_FAILED');
    }
  });

  router.post('/logout', async (req: Request, res: Response) => {
    try {
      const sessionToken = getSessionTokenFromRequest(req);
      if (sessionToken) {
        await authRepository.deleteSession(sessionToken);
      }

      clearSessionCookie(req, res);
      res.status(204).end();
    } catch (error) {
      console.error('Failed to log out:', error);
      sendApiError(res, 500, 'Failed to log out', 'LOGOUT_FAILED');
    }
  });

  router.get('/me', async (req: Request, res: Response) => {
    if (!req.auth?.user) {
      sendApiError(res, 401, 'Authentication required', 'AUTH_REQUIRED');
      return;
    }

    res.json({ user: req.auth.user });
  });

  router.post('/accept-invite', async (req: Request, res: Response) => {
    try {
      const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      if (!token) {
        sendApiError(res, 400, 'Invite token is required', 'INVITE_TOKEN_REQUIRED');
        return;
      }

      if (!name) {
        sendApiError(res, 400, 'Name is required', 'NAME_REQUIRED');
        return;
      }

      const passwordError = validatePassword(password);
      if (passwordError) {
        sendApiError(res, 400, passwordError, 'PASSWORD_INVALID');
        return;
      }

      const passwordHash = await hashPassword(password);
      const user = await authRepository.acceptInvite({ token, name, passwordHash });
      const session = await authRepository.createSession(user.id, new Date(Date.now() + SESSION_TTL_MS));

      setSessionCookie(req, res, session.token);
      res.json({ user: toAuthUser(user) });
    } catch (error) {
      if (error instanceof AuthRepositoryError) {
        sendRepositoryError(res, error);
        return;
      }

      console.error('Failed to accept invite:', error);
      sendApiError(res, 500, 'Failed to accept invite', 'ACCEPT_INVITE_FAILED');
    }
  });

  return router;
}

export default createAuthRoutes;
