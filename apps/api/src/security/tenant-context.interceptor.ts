import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantContextInterceptor.name);

  constructor(private readonly database: DatabaseService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const userId = request.auth?.user.id;
    if (!userId) {
      return next.handle();
    }

    const transaction = await this.database.beginTransaction();
    try {
      await this.database.runInContext(transaction, () =>
        this.database.activateTenant(userId),
      );
    } catch (error) {
      await this.database.finishTransaction(transaction, false);
      throw error;
    }

    let finalized = false;
    const finish = async (commit: boolean, transactionContext = transaction): Promise<void> => {
      if (finalized) {
        return;
      }
      finalized = true;
      try {
        await this.database.finishTransaction(transactionContext, commit);
      } catch {
        this.logger.error('Request database transaction could not be finalized');
        throw new Error('Request database transaction could not be finalized');
      }
    };

    return new Observable<unknown>((subscriber) => {
      let subscription: { unsubscribe(): void } | undefined;
      try {
        this.database.runInContext(transaction, () => {
          subscription = next.handle().subscribe({
            next: (value) => subscriber.next(value),
            error: (error: unknown) => {
              void finish(false);
              subscriber.error(error);
            },
            complete: () => {
              void finish(true)
                .then(() => subscriber.complete())
                .catch((error: unknown) => subscriber.error(error));
            },
          });
        });
      } catch (error) {
        void finish(false);
        subscriber.error(error);
      }

      return () => {
        subscription?.unsubscribe();
        void finish(false);
      };
    });
  }
}
