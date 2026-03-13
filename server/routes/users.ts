import { Router, type Request, type Response } from 'express';
import { sendApiError } from '../lib/api-error.js';
import { isAuthRole, type AuthRepository, type AuthRole } from '../lib/auth/repository.js';

interface CreateUsersRoutesOptions {
  bootstrapSetupToken?: string;
}

export function createUsersRoutes(authRepository: AuthRepository, options: CreateUsersRoutesOptions = {}): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    try {
      if (!req.auth?.user) {
        sendApiError(res, 401, 'Authentication required', 'AUTH_REQUIRED');
        return;
      }

      if (!['owner', 'admin'].includes(req.auth.user.role)) {
        sendApiError(res, 403, 'Insufficient permissions', 'AUTH_FORBIDDEN');
        return;
      }

      const users = await authRepository.listUsers();
      res.json({
        users: users.map((user) => ({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          createdAt: user.createdAt,
        })),
      });
    } catch (error) {
      console.error('Failed to list users:', error);
      sendApiError(res, 500, 'Failed to load users', 'USERS_LIST_FAILED');
    }
  });

  router.post('/invite', async (req: Request, res: Response) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const bootstrapToken = typeof req.body?.bootstrapToken === 'string' ? req.body.bootstrapToken.trim() : '';
      const requestedRole = typeof req.body?.role === 'string' ? req.body.role.trim().toLowerCase() : '';
      if (!email) {
        sendApiError(res, 400, 'Email is required', 'INVITE_EMAIL_REQUIRED');
        return;
      }

      const userCount = await authRepository.countUsers();
      const isBootstrapInvite = userCount === 0;

      if (!isBootstrapInvite && !req.auth?.user) {
        sendApiError(res, 401, 'Authentication required', 'AUTH_REQUIRED');
        return;
      }

      if (!isBootstrapInvite && req.auth?.user && !['owner', 'admin'].includes(req.auth.user.role)) {
        sendApiError(res, 403, 'Insufficient permissions', 'AUTH_FORBIDDEN');
        return;
      }

      if (isBootstrapInvite && options.bootstrapSetupToken && bootstrapToken !== options.bootstrapSetupToken) {
        sendApiError(res, 403, 'Bootstrap setup token is invalid', 'BOOTSTRAP_TOKEN_INVALID');
        return;
      }

      if (!isBootstrapInvite && requestedRole && !isAuthRole(requestedRole)) {
        sendApiError(res, 400, 'Invite role is invalid', 'INVITE_ROLE_INVALID');
        return;
      }

      const role: AuthRole = isBootstrapInvite
        ? 'owner'
        : (requestedRole && isAuthRole(requestedRole) ? requestedRole : 'editor');

      if (!isBootstrapInvite && role === 'owner') {
        sendApiError(res, 403, 'Insufficient permissions', 'AUTH_FORBIDDEN');
        return;
      }

      if (!isBootstrapInvite && req.auth?.user?.role === 'admin' && role === 'admin') {
        sendApiError(res, 403, 'Insufficient permissions', 'AUTH_FORBIDDEN');
        return;
      }

      const existingUser = await authRepository.findUserByEmail(email);
      if (existingUser) {
        sendApiError(res, 409, 'User already exists', 'USER_ALREADY_EXISTS');
        return;
      }

      const invite = await authRepository.createInvite({
        email,
        invitedByUserId: isBootstrapInvite ? null : (req.auth?.user.id ?? null),
        role,
      });

      res.status(201).json({
        invite: {
          token: invite.token,
          email: invite.email,
          role: invite.role,
          createdAt: invite.createdAt,
          inviteUrl: `/accept-invite/${invite.token}`,
        },
      });
    } catch (error) {
      console.error('Failed to create invite:', error);
      sendApiError(res, 500, 'Failed to create invite', 'INVITE_CREATE_FAILED');
    }
  });

  return router;
}

export default createUsersRoutes;
