import type { Response } from 'express';

export interface ApiErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}

export function sendApiError(
  res: Response,
  status: number,
  error: string,
  code?: string,
  details?: unknown,
): void {
  const payload: ApiErrorResponse = { error };
  if (code) payload.code = code;
  if (details !== undefined) payload.details = details;
  res.status(status).json(payload);
}

export function getErrorMessage(error: unknown, fallback = 'Unexpected error'): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0) return message;
  }
  if (typeof error === 'string') {
    const message = error.trim();
    if (message.length > 0) return message;
  }
  return fallback;
}

