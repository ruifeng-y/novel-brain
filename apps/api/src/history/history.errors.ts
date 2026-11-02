import { HttpException, HttpStatus } from '@nestjs/common';

export function historyError(
  status: HttpStatus,
  code: string,
  message: string,
  details?: unknown,
): HttpException {
  return new HttpException(
    {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
    status,
  );
}
