import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SessionUser } from '../../shared/auth/session-user';
import { verifyPassword } from '../../shared/auth/password';
import { signSessionToken } from '../../shared/auth/token';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dtos/login.dto';

@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}

  async login(dto: LoginDto): Promise<{ token: string; user: SessionUser }> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user || !(await verifyPassword(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.createSession(this.usersService.toSessionUser(user));
  }

  async impersonate(userId: string): Promise<{ token: string; user: SessionUser }> {
    const user = await this.usersService.requireById(userId);
    return this.createSession(this.usersService.toSessionUser(user));
  }

  async listUsers(): Promise<SessionUser[]> {
    return this.usersService.list();
  }

  createSession(user: SessionUser): { token: string; user: SessionUser } {
    return {
      token: signSessionToken(user),
      user,
    };
  }
}
