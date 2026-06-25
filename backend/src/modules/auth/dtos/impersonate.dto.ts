import { IsMongoId } from 'class-validator';

export class ImpersonateDto {
  @IsMongoId()
  userId: string;
}
