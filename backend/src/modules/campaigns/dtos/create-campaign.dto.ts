import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class SequenceStepDto {
  @IsOptional()
  @IsString()
  stepId?: string;

  @IsInt()
  @Min(1)
  order: number;

  @IsInt()
  @Min(0)
  delayMinutes: number;

  @IsString()
  @IsNotEmpty()
  subjectTemplate: string;

  @IsString()
  @IsNotEmpty()
  promptTemplate: string;
}

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  /** Must contain {{placeholders}} that map to contact fields. */
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
