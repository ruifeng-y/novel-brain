import { HttpException, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export function modelConfigError(
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
      requestId: randomUUID(),
    },
    status,
  );
}
