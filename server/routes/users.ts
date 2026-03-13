import { Router, type Request, type Response } from 'express';
import { sendApiError } from '../lib/api-error.js';
import { type AuthRepository } from '../lib/auth/repository.js';

export function createUsersRoutes(authRepository: AuthRepository): Router {
  const router = Router();

  router.post('/invite', async (req: Request, res: Response) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
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

      const existingUser = await authRepository.findUserByEmail(email);
      if (existingUser) {
        sendApiError(res, 409, 'User already exists', 'USER_ALREADY_EXISTS');
        return;
      }

      const invite = await authRepository.createInvite({
        email,
        invitedByUserId: isBootstrapInvite ? null : (req.auth?.user.id ?? null),
      });

      res.status(201).json({
        invite: {
          token: invite.token,
          email: invite.email,
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
