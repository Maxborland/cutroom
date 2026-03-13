import type { Request, Response } from 'express';

export const SESSION_COOKIE_NAME = 'cutroom_session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function resolveSecureCookie(req: Request): boolean {
  const configured = (process.env.AUTH_COOKIE_SECURE ?? '').trim().toLowerCase();
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  if (process.env.NODE_ENV !== 'production') return false;

  const forwardedProtoHeader = req.header('x-forwarded-proto');
  const forwardedProto = forwardedProtoHeader?.split(',')[0]?.trim().toLowerCase();
  if (forwardedProto === 'https') {
    return true;
  }

  return Boolean(req.secure);
}

function buildCookieOptions(req: Request) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: resolveSecureCookie(req),
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, buildCookieOptions(req));
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: resolveSecureCookie(req),
    path: '/',
  });
}

function parseCookies(cookieHeader: string | undefined): Map<string, string> {
  if (!cookieHeader) {
    return new Map();
  }

  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Map<string, string>>((cookies, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) {
        return cookies;
      }

      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (!key) {
        return cookies;
      }

      cookies.set(key, decodeURIComponent(value));
      return cookies;
    }, new Map<string, string>());
}

export function getSessionTokenFromRequest(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  return cookies.get(SESSION_COOKIE_NAME) ?? null;
}
