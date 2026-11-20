import type { NextFunction, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';

export interface VerifiedOidcPayload {
  email?: string;
  email_verified?: boolean;
}

export interface RequireGoogleOidcDeps {
  expectedServiceAccount: string | (() => string);
  audience: string | (() => string);
  verifyOidcToken?: (token: string, audience: string) => Promise<VerifiedOidcPayload>;
}

const defaultOidcClient = new OAuth2Client();

async function defaultVerifyOidcToken(
  token: string,
  audience: string,
): Promise<VerifiedOidcPayload> {
  const ticket = await defaultOidcClient.verifyIdToken({
    idToken: token,
    audience,
  });
  const payload = ticket.getPayload();
  return {
    email: payload?.email,
    email_verified: payload?.email_verified,
  };
}

function resolveSetting(setting: string | (() => string)): string {
  return (typeof setting === 'function' ? setting() : setting).trim();
}

export function createRequireGoogleOidc(deps: RequireGoogleOidcDeps) {
  const verify = deps.verifyOidcToken ?? defaultVerifyOidcToken;

  return async function requireGoogleOidc(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const authHeader = req.header('authorization') ?? '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      res.status(401).json({ error: 'Missing Google OIDC Bearer token' });
      return;
    }

    const audience = resolveSetting(deps.audience);
    const expectedServiceAccount = resolveSetting(deps.expectedServiceAccount);

    if (!audience || !expectedServiceAccount) {
      res.status(503).json({ error: 'Internal OIDC verification is not configured' });
      return;
    }

    try {
      const payload = await verify(match[1].trim(), audience);
      const email = payload.email?.trim().toLowerCase() ?? '';
      const expected = expectedServiceAccount.toLowerCase();

      if (payload.email_verified !== true || email !== expected) {
        res.status(403).json({ error: 'OIDC service account identity mismatch' });
        return;
      }

      next();
    } catch {
      res.status(401).json({ error: 'Invalid Google OIDC token' });
    }
  };
}

export function createPubSubOidcMiddleware() {
  return createRequireGoogleOidc({
    expectedServiceAccount: () => process.env.PUBSUB_PUSH_SERVICE_ACCOUNT?.trim() || '',
    audience: () => process.env.INTERNAL_OIDC_AUDIENCE?.trim() || '',
  });
}

export function createSchedulerOidcMiddleware() {
  return createRequireGoogleOidc({
    expectedServiceAccount: () => process.env.SCHEDULER_SERVICE_ACCOUNT?.trim() || '',
    audience: () => process.env.INTERNAL_OIDC_AUDIENCE?.trim() || '',
  });
}
