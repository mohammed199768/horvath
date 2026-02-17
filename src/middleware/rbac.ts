import { NextFunction, Response } from 'express';
import { AuthRequest } from './auth';

const ROLE_LEVEL: Record<string, number> = {
  creator: 10,
  admin: 20,
  super_admin: 30,
};

const resolveRoleLevel = (role: string): number => ROLE_LEVEL[role] ?? -1;

export const requireRole = (...allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const currentRole = req.user.role;
    const currentLevel = resolveRoleLevel(currentRole);
    const minAllowedLevel = Math.min(...allowedRoles.map(resolveRoleLevel));

    // Hierarchical RBAC:
    // super_admin >= admin >= creator
    const isAllowedByHierarchy = Number.isFinite(minAllowedLevel) && currentLevel >= minAllowedLevel;
    const isAllowedByDirectMatch = allowedRoles.includes(currentRole);

    if (!isAllowedByHierarchy && !isAllowedByDirectMatch) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: allowedRoles,
        current: currentRole,
      });
    }

    next();
  };
};
