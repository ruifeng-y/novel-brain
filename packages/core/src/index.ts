import { randomUUID } from "node:crypto";

export type RandomUuid = () => string;

export function createRequestId(generateUuid: RandomUuid = randomUUID): string {
  return `req_${generateUuid()}`;
}

export function elapsedMilliseconds(startedAt: bigint): number {
  const elapsedNanoseconds = process.hrtime.bigint() - startedAt;
  return Math.round(Number(elapsedNanoseconds) / 100_000) / 10;
}
