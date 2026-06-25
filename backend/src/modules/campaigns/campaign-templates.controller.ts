import { Controller, Get, UseGuards } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { UserGuard } from '../../shared/auth/user.guard';

@Controller('campaign-templates')
@UseGuards(UserGuard)
export class CampaignTemplatesController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  list() {
    return this.campaignsService.listTemplates();
  }
}
