import type { NextFunction, Request, Response } from 'express';
import { getFirebaseAdminServices } from '../config/firebaseAdmin.ts';
import { getServerRepository } from '../services/serverRepository.ts';

export interface VerifiedHostContext {
  uid: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
}

export interface HostAuthRequest extends Request {
  hostUser?: VerifiedHostContext;
}

export interface RequireHostAuthDeps {
  verifyIdToken: (
    token: string,
  ) => Promise<{ uid: string; email?: string; email_verified?: boolean; name?: string }>;
  getAllowedEmails: () => Promise<string[]>;
  allowLocalDevBypass?: boolean | (() => boolean);
}

function extractBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) {
    return null;
  }
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function createRequireHostAuth(deps: RequireHostAuthDeps) {
  const isBypassEnabled = (): boolean =>
    typeof deps.allowLocalDevBypass === 'function'
      ? deps.allowLocalDevBypass()
      : Boolean(deps.allowLocalDevBypass);

  return async function requireHostAuth(
    req: HostAuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const token = extractBearerToken(req.header('authorization'));

    if (!token && isBypassEnabled()) {
      req.hostUser = {
        uid: 'local-host-alex',
        email: 'alex@example.com',
        displayName: 'Alex',
        emailVerified: true,
      };
      next();
      return;
    }

    if (!token) {
      res.status(401).json({ error: 'Missing Authorization Bearer token' });
      return;
    }

    try {
      const decoded = await deps.verifyIdToken(token);
      const email = decoded.email?.trim().toLowerCase() ?? '';

      if (!email || decoded.email_verified !== true) {
        res.status(403).json({ error: 'Verified Google email is required' });
        return;
      }

      const allowedEmails = (await deps.getAllowedEmails())
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      if (allowedEmails.length === 0 || !allowedEmails.includes(email)) {
        res.status(403).json({ error: 'Account is not on the Haven host allowlist' });
        return;
      }

      req.hostUser = {
        uid: decoded.uid,
        email,
        displayName: decoded.name?.trim() || email.split('@')[0] || 'Host',
        emailVerified: true,
      };
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired Firebase ID token' });
    }
  };
}

export const requireHostAuth = createRequireHostAuth({
  verifyIdToken: async (token) => {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      throw new Error('Firebase Admin is not initialized');
    }
    return admin.auth.verifyIdToken(token);
  },
  getAllowedEmails: () => getServerRepository().getAllowedEmails(),
  allowLocalDevBypass: () =>
    process.env.NODE_ENV !== 'production' && !getFirebaseAdminServices(),
});
