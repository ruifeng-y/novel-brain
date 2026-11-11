import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { idempotencyRecords } from "./schema";
import type { DatabaseTransaction } from "./tenant";

export interface IdempotentResource {
  resourceType: string;
  resourceId: string;
}

export async function findIdempotentResource(
  transaction: DatabaseTransaction,
  userId: string,
  scope: string,
  idempotencyKey: string,
): Promise<IdempotentResource | null> {
  const [record] = await transaction
    .select({
      resourceType: idempotencyRecords.resourceType,
      resourceId: idempotencyRecords.resourceId,
    })
    .from(idempotencyRecords)
    .where(
      and(
        eq(idempotencyRecords.userId, userId),
        eq(idempotencyRecords.scope, scope),
        eq(idempotencyRecords.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return record ?? null;
}

export async function rememberIdempotentResource(
  transaction: DatabaseTransaction,
  userId: string,
  scope: string,
  idempotencyKey: string,
  resource: IdempotentResource,
): Promise<void> {
  await transaction.insert(idempotencyRecords).values({
    id: uuidv7(),
    userId,
    scope,
    idempotencyKey,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
  });
}
