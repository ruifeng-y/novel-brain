import { Controller, Get, HttpStatus, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { exportsError } from './exports.errors';
import { sendExportDownload } from './download-response';
import { ExportsService } from './exports.service';

@ApiTags('downloads')
@Controller('downloads')
export class DownloadsController {
  constructor(private readonly exports: ExportsService) {}

  @Get(':token')
  @ApiOperation({ summary: 'Download an export with a short-lived signed link' })
  async download(@Param('token') token: string, @Res() response: Response): Promise<void> {
    if (!token) {
      throw exportsError(
        HttpStatus.FORBIDDEN,
        'DOWNLOAD_LINK_INVALID',
        'This download link is invalid or has expired',
      );
    }
    const file = await this.exports.downloadSignedToken(token);
    sendExportDownload(response, file);
  }
}
