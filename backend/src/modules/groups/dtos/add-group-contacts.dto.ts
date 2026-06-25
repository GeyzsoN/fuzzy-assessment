import { ArrayNotEmpty, IsArray, IsMongoId } from 'class-validator';

export class AddGroupContactsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsMongoId({ each: true })
  contactIds: string[];
}
