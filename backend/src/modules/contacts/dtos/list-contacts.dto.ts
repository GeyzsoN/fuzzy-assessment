import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Query DTO for the stable paginated contacts list.
 */
export class ListContactsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  /** Matches name and company. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['name', 'email', 'company', 'createdAt'])
  sort?: 'name' | 'email' | 'company' | 'createdAt' = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  direction?: 'asc' | 'desc';
}
