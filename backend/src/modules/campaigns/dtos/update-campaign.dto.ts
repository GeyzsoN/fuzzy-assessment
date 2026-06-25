import { Type } from 'class-transformer';
import {
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { SequenceStepDto } from './create-campaign.dto';

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  promptTemplate?: string;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  groupIds?: string[];

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  contactIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SequenceStepDto)
  sequenceSteps?: SequenceStepDto[];
}
