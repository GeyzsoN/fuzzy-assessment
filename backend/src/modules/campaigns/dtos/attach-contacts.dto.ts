import { ArrayNotEmpty, IsArray, IsMongoId } from 'class-validator';

export class AttachContactsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsMongoId({ each: true })
  contactIds: string[];
}
