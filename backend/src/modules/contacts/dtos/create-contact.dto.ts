import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * STARTER DTO. Bad input must yield a 400 (the global ValidationPipe handles this
 * once your decorators are correct). Add/adjust validation as you see fit.
 */
export class CreateContactDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  title?: string;
}
