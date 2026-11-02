import type { Response } from 'express';

export type ExportDownloadFile = {
  data: Buffer;
  fileName: string;
  mimeType: string;
};

export function sendExportDownload(response: Response, file: ExportDownloadFile): void {
  response.setHeader('Content-Type', file.mimeType);
  response.setHeader(
    'Content-Disposition',
    `attachment; filename="novel-export"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
  );
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.send(file.data);
}
