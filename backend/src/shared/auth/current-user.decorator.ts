import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Injects the current user id (set by UserGuard) into a controller handler.
 *
 *   @UseGuards(UserGuard)
 *   @Get()
 *   list(@CurrentUser() userId: string) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest();
    return req.userId;
  },
);
