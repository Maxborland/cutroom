import { Router, type NextFunction, type Request, type Response } from 'express';
import { sendApiError } from '../lib/api-error.js';
import { requireAuthenticatedUser } from '../lib/auth/middleware.js';
import type { AuthRepository, type AuthRole } from '../lib/auth/repository.js';

interface CreateUsersRoutesOptions {
  bootstrapSetupToken?: string;
  inviteRateLimitWindowMs?: number;
  inviteRateLimitMax?: number;
}

const TEAM_INVITE_ROLES_BY_ACTOR = {
  owner: ['admin', 'editor', 'viewer'],
  admin: ['editor', 'viewer'],
} as const satisfies Partial<Record<AuthRole, readonly AuthRole[]>>;

type TeamInviteActorRole = keyof typeof TEAM_INVITE_ROLES_BY_ACTOR;
type TeamInviteRole = (typeof TEAM_INVITE_ROLES_BY_ACTOR)[TeamInviteActorRole][number];
type UsersRouteLocals = {
  bootstrapInvite?: {
    email: string;
    bootstrapToken: string;
  };
  teamInvite?: {
    email: string;
    role: TeamInviteRole;
  };
};

function parseNormalizedEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function parseBootstrapToken(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseRequestedRole(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isTeamInviteActorRole(role: AuthRole): role is TeamInviteActorRole {
  return Object.prototype.hasOwnProperty.call(TEAM_INVITE_ROLES_BY_ACTOR, role);
}

function createRouteRateLimiter(windowMs: number, max: number) {
  const store = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = `${req.path}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (entry.count >= max) {
      sendApiError(res, 429, 'Too many requests', 'RATE_LIMIT_EXCEEDED');
      return;
    }

    entry.count += 1;
    next();
  };
}

function requireBootstrapInviteInput(req: Request, res: Response, next: NextFunction): void {
  const email = parseNormalizedEmail(req.body?.email);
  if (!email) {
    sendApiError(res, 400, 'Email is required', 'INVITE_EMAIL_REQUIRED');
    return;
  }

  (res.locals as UsersRouteLocals).bootstrapInvite = {
    email,
    bootstrapToken: parseBootstrapToken(req.body?.bootstrapToken),
  };
  next();
}

function resolveTeamInviteRole(actorRole: AuthRole, value: unknown):
  | { ok: true; role: TeamInviteRole }
  | { ok: false; status: 400 | 403; code: string; message: string } {
  const requestedRole = parseRequestedRole(value);

  if (actorRole === 'owner') {
    switch (requestedRole) {
      case '':
      case 'editor':
        return { ok: true, role: 'editor' };
      case 'viewer':
        return { ok: true, role: 'viewer' };
      case 'admin':
        return { ok: true, role: 'admin' };
      case 'owner':
        return { ok: false, status: 403, code: 'AUTH_FORBIDDEN', message: 'Insufficient permissions' };
      default:
        return { ok: false, status: 400, code: 'INVITE_ROLE_INVALID', message: 'Invite role is invalid' };
    }
  }

  if (actorRole === 'admin') {
    switch (requestedRole) {
      case '':
      case 'editor':
        return { ok: true, role: 'editor' };
      case 'viewer':
        return { ok: true, role: 'viewer' };
      case 'admin':
      case 'owner':
        return { ok: false, status: 403, code: 'AUTH_FORBIDDEN', message: 'Insufficient permissions' };
      default:
        return { ok: false, status: 400, code: 'INVITE_ROLE_INVALID', message: 'Invite role is invalid' };
    }
  }

  return { ok: false, status: 403, code: 'AUTH_FORBIDDEN', message: 'Insufficient permissions' };
}

function requireTeamInviteInput(req: Request, res: Response, next: NextFunction): void {
  const email = parseNormalizedEmail(req.body?.email);
  if (!email) {
    sendApiError(res, 400, 'Email is required', 'INVITE_EMAIL_REQUIRED');
    return;
  }

  const authUser = req.auth?.user;
  if (!authUser) {
    sendApiError(res, 401, 'Authentication required', 'AUTH_REQUIRED');
    return;
  }

  if (!isTeamInviteActorRole(authUser.role)) {
    sendApiError(res, 403, 'Insufficient permissions', 'AUTH_FORBIDDEN');
    return;
  }

  const resolution = resolveTeamInviteRole(authUser.role, req.body?.role);
  if (!resolution.ok) {
    sendApiError(res, resolution.status, resolution.message, resolution.code);
    return;
  }

  (res.locals as UsersRouteLocals).teamInvite = {
    email,
    role: resolution.role,
  };
  next();
}

export function createUsersRoutes(authRepository: AuthRepository, options: CreateUsersRoutesOptions = {}): Router {
  const router = Router();
  const inviteRateLimit = createRouteRateLimiter(
    options.inviteRateLimitWindowMs ?? 60_000,
    options.inviteRateLimitMax ?? 20,
  );

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

  router.post('/bootstrap-owner-invite', inviteRateLimit, requireBootstrapInviteInput, async (req: Request, res: Response) => {
    try {
      const { email, bootstrapToken } = (res.locals as UsersRouteLocals).bootstrapInvite ?? { email: '', bootstrapToken: '' };

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

  router.post('/invite', inviteRateLimit, requireAuthenticatedUser, requireTeamInviteInput, async (req: Request, res: Response) => {
    try {
      const authUser = req.auth?.user;
      const teamInvite = (res.locals as UsersRouteLocals).teamInvite;
      if (!authUser || !teamInvite) {
        sendApiError(res, 401, 'Authentication required', 'AUTH_REQUIRED');
        return;
      }

      const existingUser = await authRepository.findUserByEmail(teamInvite.email);
      if (existingUser) {
        sendApiError(res, 409, 'User already exists', 'USER_ALREADY_EXISTS');
        return;
      }

      const invite = await authRepository.createInvite({
        email: teamInvite.email,
        invitedByUserId: authUser.id,
        role: teamInvite.role,
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
