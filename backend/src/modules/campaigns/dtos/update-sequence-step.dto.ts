import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateSequenceStepDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  delayMinutes?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  subjectTemplate?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  promptTemplate?: string;
}

export class RegenerateSequenceStepDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  instructions?: string;
}
