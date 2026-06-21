import { IsNotEmpty, IsString } from 'class-validator';

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  /** Must contain {{placeholders}} that map to contact fields. */
  @IsString()
  @IsNotEmpty()
  promptTemplate: string;
}
