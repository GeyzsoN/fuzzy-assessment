import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SessionUser, UserRole } from '../../shared/auth/session-user';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  toSessionUser(user: UserDocument | (User & { _id: unknown })): SessionUser {
    return {
      id: String(user._id),
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase().trim() }).exec();
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async requireById(id: string): Promise<UserDocument> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async list(): Promise<SessionUser[]> {
    const users = await this.userModel.find().sort({ role: 1, email: 1 }).exec();
    return users.map((user) => this.toSessionUser(user));
  }

  async create(input: {
    name: string;
    email: string;
    passwordHash: string;
    role: UserRole;
  }): Promise<UserDocument> {
    return this.userModel.create(input);
  }
}
