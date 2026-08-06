import type { ErrorHandler } from 'hono';

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public suggestion = '',
  ) {
    super(message);
  }
}

export const notFound = (entity: string, id: string) =>
  new AppError(
    'NOT_FOUND',
    `${entity} '${id}' not found`,
    404,
    `Use GET /api/v1/${entity.toLowerCase()}s to list available IDs`,
  );

export const validationError = (message: string) =>
  new AppError('VALIDATION_ERROR', message, 400, 'Check request body');

/**
 * Shared error renderer. Used by the public app and by the internal router
 * behind the MCP endpoint so both emit the same {error:{code,message,suggestion}}.
 */
export const errorHandler: ErrorHandler = (err, c) => {
  const status = (err as any).status ?? 500;
  return c.json(
    {
      error: {
        code: (err as any).code ?? 'INTERNAL_ERROR',
        message: err.message,
        suggestion: (err as any).suggestion ?? 'Check server logs',
      },
    },
    status,
  );
};
