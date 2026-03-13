import { Router, type Request, type Response } from 'express';
import { sendApiError } from '../lib/api-error.js';
import { isAuthRole, type AuthRepository, type AuthRole } from '../lib/auth/repository.js';

interface CreateUsersRoutesOptions {
  bootstrapSetupToken?: string;
}

const TEAM_INVITE_ROLES_BY_ACTOR = {
  owner: ['admin', 'editor', 'viewer'],
  admin: ['editor', 'viewer'],
} as const satisfies Partial<Record<AuthRole, readonly AuthRole[]>>;

function parseNormalizedEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function parseBootstrapToken(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseRequestedRole(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
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

  router.post('/bootstrap-owner-invite', async (req: Request, res: Response) => {
    try {
      const email = parseNormalizedEmail(req.body?.email);
      const bootstrapToken = parseBootstrapToken(req.body?.bootstrapToken);
      if (!email) {
        sendApiError(res, 400, 'Email is required', 'INVITE_EMAIL_REQUIRED');
        return;
      }

      const userCount = await authRepository.countUsers();
      if (userCount !== 0) {
        sendApiError(res, 409, 'Bootstrap invite flow is closed', 'BOOTSTRAP_INVITE_CLOSED');
        return;
      }

      if (options.bootstrapSetupToken && bootstrapToken !== options.bootstrapSetupToken) {
        sendApiError(res, 403, 'Bootstrap setup token is invalid', 'BOOTSTRAP_TOKEN_INVALID');
        return;
      }

      const existingUser = await authRepository.findUserByEmail(email);
      if (existingUser) {
        sendApiError(res, 409, 'User already exists', 'USER_ALREADY_EXISTS');
        return;
      }

      const invite = await authRepository.createInvite({
        email,
        invitedByUserId: null,
        role: 'owner',
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
      console.error('Failed to create bootstrap invite:', error);
      sendApiError(res, 500, 'Failed to create bootstrap invite', 'INVITE_CREATE_FAILED');
    }
  });

  router.post('/invite', async (req: Request, res: Response) => {
    try {
      const email = parseNormalizedEmail(req.body?.email);
      const requestedRole = parseRequestedRole(req.body?.role);
      if (!email) {
        sendApiError(res, 400, 'Email is required', 'INVITE_EMAIL_REQUIRED');
        return;
      }

      if (!req.auth?.user) {
        sendApiError(res, 401, 'Authentication required', 'AUTH_REQUIRED');
        return;
      }

      const allowedRoles = TEAM_INVITE_ROLES_BY_ACTOR[req.auth.user.role];
      if (!allowedRoles) {
        sendApiError(res, 403, 'Insufficient permissions', 'AUTH_FORBIDDEN');
        return;
      }

      if (requestedRole && !isAuthRole(requestedRole)) {
        sendApiError(res, 400, 'Invite role is invalid', 'INVITE_ROLE_INVALID');
        return;
      }

      const role = (requestedRole || 'editor') as AuthRole;
      if (!allowedRoles.includes(role)) {
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
        invitedByUserId: req.auth.user.id,
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
