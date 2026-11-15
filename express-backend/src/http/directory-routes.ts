import { Router } from 'express';
import type { RequestHandler } from 'express';

import type { AuthService } from '../access/sessions.js';
import { SalarySortUnavailableError } from '../directory/directory-repository.js';
import type { DirectoryService } from '../directory/directory-repository.js';
import type { AuthLocals } from './auth-routes.js';
import { requireAuth } from './auth-routes.js';
import {
  DirectoryOptionsResponse,
  DirectoryQueryParams,
  DirectoryResponse,
  EMPLOYEE_NOT_FOUND_MESSAGE,
  EmployeeDetailResponse,
  PATHS,
} from './contract.js';
import { ApiError } from './errors.js';

// Compensation data must not be stored by shared caches or the browser.
const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

export function directoryRoutes({ auth, directory }: { auth: AuthService; directory: DirectoryService }): Router {
  const router = Router();
  const authenticated = requireAuth(auth);

  router.get(PATHS.employees, noStore, authenticated, async (req, res) => {
    const parsed = DirectoryQueryParams.safeParse(req.query);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR');
    const { principal } = res.locals as AuthLocals;
    try {
      res.json(DirectoryResponse.parse(await directory.list(principal, parsed.data)));
    } catch (error) {
      if (error instanceof SalarySortUnavailableError) throw new ApiError(400, 'VALIDATION_ERROR', error.message);
      throw error;
    }
  });

  router.get(PATHS.employee, noStore, authenticated, async (req, res) => {
    const { principal } = res.locals as AuthLocals;
    const employeeCode = req.params.employeeCode;
    const found = typeof employeeCode === 'string' ? await directory.detail(principal, employeeCode) : null;
    // Unknown and out-of-scope employees get the same response.
    if (found === null) throw new ApiError(404, 'NOT_FOUND', EMPLOYEE_NOT_FOUND_MESSAGE);
    res.json(EmployeeDetailResponse.parse(found));
  });

  router.get(PATHS.directoryOptions, noStore, authenticated, async (_req, res) => {
    const { principal } = res.locals as AuthLocals;
    res.json(DirectoryOptionsResponse.parse(await directory.options(principal)));
  });

  return router;
}
