import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class GenerateCampaignDraftDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  goal: string;

  @IsString()
  @IsNotEmpty()
  audienceDescription: string;

  @IsString()
  @IsNotEmpty()
  templateId: string;

  @IsOptional()
  @IsString()
  tone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  maxSteps?: number;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  groupIds?: string[];

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  contactIds?: string[];
}
