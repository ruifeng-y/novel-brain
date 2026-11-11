interface CursorPage<T> {
  data: T[];
  meta: {
    nextCursor: string | null;
  };
}

export async function fetchAllCursorPages<T>(
  url: string,
  parsePage: (input: unknown) => CursorPage<T>,
  errorMessage: string,
  onResponse?: (response: Response) => void,
): Promise<T[]> {
  const items: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  do {
    const pageUrl = new URL(url, window.location.origin);
    pageUrl.searchParams.set("limit", "20");
    if (cursor) {
      pageUrl.searchParams.set("cursor", cursor);
    }
    const response = await fetch(`${pageUrl.pathname}${pageUrl.search}`, {
      cache: "no-store",
    });
    onResponse?.(response);
    if (!response.ok) {
      throw new Error(errorMessage);
    }
    const page = parsePage(await response.json());
    items.push(...page.data);
    cursor = page.meta.nextCursor;
    if (cursor && seenCursors.has(cursor)) {
      throw new Error("分页游标重复，已停止加载。");
    }
    if (cursor) {
      seenCursors.add(cursor);
    }
  } while (cursor);

  return items;
}
