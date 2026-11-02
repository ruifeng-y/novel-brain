import { HttpException, HttpStatus } from '@nestjs/common';

export function changesError(
  status: HttpStatus,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): HttpException {
  return new HttpException(
    {
      code,
      message,
      details,
    },
    status,
  );
}
