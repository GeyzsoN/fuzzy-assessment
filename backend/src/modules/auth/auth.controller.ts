import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UserGuard } from '../../shared/auth/user.guard';
import { AdminGuard } from '../../shared/auth/admin.guard';
import {
  CurrentSessionUser,
} from '../../shared/auth/current-user.decorator';
import { SessionUser } from '../../shared/auth/session-user';
import { AuthService } from './auth.service';
import { ImpersonateDto } from './dtos/impersonate.dto';
import { LoginDto } from './dtos/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(UserGuard)
  me(@CurrentSessionUser() user: SessionUser) {
    return user;
  }

  @Get('users')
  @UseGuards(UserGuard, AdminGuard)
  users() {
    return this.authService.listUsers();
  }

  @Post('impersonate')
  @UseGuards(UserGuard, AdminGuard)
  impersonate(@Body() dto: ImpersonateDto) {
    return this.authService.impersonate(dto.userId);
  }
}
