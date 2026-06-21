import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Lightweight auth stand-in for the assessment.
 *
 * In the real system, a session/JWT resolves the current user. Here we trust an
 * `x-user-id` header and attach it as `req.userId`. Apply this guard to any
 * controller whose resources must be user-scoped, and read the id with the
 * `@CurrentUser()` decorator.
 *
 * Your job: make sure contacts/campaigns are actually scoped to this id so one
 * user cannot read or mutate another user's data.
 */
@Injectable()
export class UserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { userId?: string }>();
    const userId = req.header('x-user-id');
    if (!userId) {
      throw new UnauthorizedException('Missing x-user-id header');
    }
    req.userId = userId;
    return true;
  }
}
