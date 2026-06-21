import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * STARTER query DTO for the paginated list.
 *
 * TODO(candidate): use these (and add what you need) to build a STABLE paginated
 * query. Remember: the same contact must never appear on two pages as records are
 * added. Think hard about the sort.
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
  @IsIn(['name', 'createdAt'])
  sort?: 'name' | 'createdAt' = 'createdAt';
}
