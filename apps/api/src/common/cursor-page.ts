import { ApiError } from "./api-error";

export interface CursorPageResult<T> {
  data: T[];
  nextCursor: string | null;
}

export function toCursorPage<T extends { id: string }>(
  rows: T[],
  limit: number,
): CursorPageResult<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return {
    data,
    nextCursor: hasMore ? (data.at(-1)?.id ?? null) : null,
  };
}

export function invalidCursorError(): ApiError {
  return new ApiError(400, "VALIDATION_INVALID", "分页游标无效，请刷新后重试");
}
