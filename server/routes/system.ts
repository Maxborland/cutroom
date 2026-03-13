import { Router, type Request, type Response } from 'express';
import { sendApiError } from '../lib/api-error.js';
import { createLicensingService } from '../lib/licensing/service.js';
import type { LicensingService } from '../lib/licensing/types.js';

export function createSystemRoutes(licensingService?: LicensingService): Router {
  const router = Router();

  router.get('/license', async (_req: Request, res: Response) => {
    try {
      const status = await (licensingService ?? createLicensingService()).getLicenseStatus();
      res.json(status);
    } catch (error) {
      console.error('Failed to read license status:', error);
      sendApiError(res, 500, 'Failed to read license status', 'LICENSE_STATUS_READ_FAILED');
    }
  });

  return router;
}

export default createSystemRoutes;
