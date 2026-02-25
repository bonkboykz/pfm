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
