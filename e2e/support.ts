import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';

export async function useIsolatedClientIp(page: Page): Promise<void> {
  const [a, b, c] = randomBytes(3);
  await page.context().setExtraHTTPHeaders({
    'X-Forwarded-For': `10.${a}.${b}.${c}`,
  });
}
