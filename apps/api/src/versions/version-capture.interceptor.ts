import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { mergeMap, type Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { VersionGraphService } from './version-graph.service';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SKIP_PATTERNS = [
  /\/autosave$/,
  /\/versions(?:\/[^/]+\/restore)?$/,
  /\/changes(?:\/.*)?$/,
  /\/jobs(?:\/.*)?$/,
  /\/exports(?:\/.*)?$/,
  /\/rollback$/,
  /\/audit(?:\/.*)?$/,
  /\/(?:generate|continue|rewrite|expand|condense|change-pov|hooks|title|summary|extract-facts|verify)$/,
  /\/fact-proposals\/[^/]+\/reject$/,
];

@Injectable()
export class VersionCaptureInterceptor implements NestInterceptor {
  constructor(private readonly versions: VersionGraphService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const userId = request.auth?.user.id;
    const workId = request.params?.workId;
    const branchId = request.params?.branchId;
    const path = request.path ?? request.url;
    if (
      !userId ||
      typeof workId !== 'string' ||
      typeof branchId !== 'string' ||
      !MUTATING_METHODS.has(request.method) ||
      SKIP_PATTERNS.some((pattern) => pattern.test(path))
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      mergeMap(async (value) => {
        const title = this.titleFor(request);
        await this.versions.recordVersion({
          userId,
          workId,
          branchId,
          kind: 'edit',
          title,
          reason: this.reasonFor(request, title),
          metadata: {
            method: request.method,
            path,
          },
          ip: this.clientIp(request),
          userAgent: request.get('user-agent') ?? null,
        });
        return value;
      }),
    );
  }

  private titleFor(request: Request & AuthenticatedRequest): string {
    const path = request.path ?? request.url;
    if (path.endsWith('/story-bible/lock')) {
      return '锁定故事圣经';
    }
    if (path.endsWith('/story-bible')) {
      return '保存故事圣经';
    }
    if (path.includes('/fact-proposals/') && path.endsWith('/confirm')) {
      return '确认故事事实';
    }
    if (path.includes('/outlines/reorder')) {
      return '调整大纲顺序';
    }
    if (path.match(/\/outlines\/[^/]+\/lock$/)) {
      return '锁定大纲节点';
    }
    if (path.match(/\/outlines\/[^/]+\/unlock$/)) {
      return '解锁大纲节点';
    }
    if (path.match(/\/outlines\/[^/]+\/regenerate$/)) {
      return '重新生成大纲节点';
    }
    if (path.includes('/outlines')) {
      return this.actionLabel(request.method, '大纲');
    }
    if (path.includes('/entities/') && path.endsWith('/relations')) {
      return '添加人物关系';
    }
    if (path.includes('/custom-fields')) {
      return this.actionLabel(request.method, '设定字段');
    }
    if (path.includes('/entities')) {
      return this.actionLabel(request.method, '设定');
    }
    if (path.match(/\/characters\/[^/]+\/state$/)) {
      return '更新人物状态';
    }
    if (path.match(/\/characters\/[^/]+\/profile$/)) {
      return '更新人物档案';
    }
    if (path.includes('/map')) {
      return this.actionLabel(request.method, '地图内容');
    }
    if (path.includes('/timeline')) {
      return this.actionLabel(request.method, '时间线');
    }
    if (path.includes('/power-systems') || path.includes('/golden-fingers')) {
      return this.actionLabel(request.method, '力量体系');
    }
    if (path.includes('/item-techniques') || path.includes('/item-ownerships')) {
      return this.actionLabel(request.method, '物品与功法');
    }
    if (path.includes('/threads') || path.includes('/foreshadows')) {
      return this.actionLabel(request.method, '剧情线索');
    }
    if (path.includes('/character-arcs')) {
      return this.actionLabel(request.method, '人物弧光');
    }
    if (path.match(/\/chapters\/\d+$/)) {
      return '更新章节信息';
    }
    return this.actionLabel(request.method, '故事内容');
  }

  private actionLabel(method: string, target: string): string {
    if (method === 'POST') {
      return `添加${target}`;
    }
    if (method === 'DELETE') {
      return `删除${target}`;
    }
    if (method === 'PATCH') {
      return `修改${target}`;
    }
    return `保存${target}`;
  }

  private reasonFor(request: Request & AuthenticatedRequest, fallback: string): string {
    const body =
      request.body && typeof request.body === 'object'
        ? (request.body as Record<string, unknown>)
        : {};
    for (const key of ['reason', 'changeReason', 'title', 'name'] as const) {
      const value = body[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return fallback;
  }

  private clientIp(request: Request): string | null {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0]?.trim() ?? null;
    }
    return request.ip ?? null;
  }
}
