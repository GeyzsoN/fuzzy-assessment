import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dtos/create-campaign.dto';
import { AttachContactsDto } from './dtos/attach-contacts.dto';
import { UserGuard } from '../../shared/auth/user.guard';
import { CurrentUser } from '../../shared/auth/current-user.decorator';

@Controller('campaigns')
@UseGuards(UserGuard)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateCampaignDto) {
    return this.campaignsService.create(userId, dto);
  }

  @Get(':id')
  getOne(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.campaignsService.getOne(userId, id);
  }

  @Post(':id/contacts')
  attachContacts(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: AttachContactsDto,
  ) {
    return this.campaignsService.attachContacts(userId, id, dto);
  }

  @Post(':id/contacts/:contactId/generate')
  generate(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Param('contactId') contactId: string,
  ) {
    return this.campaignsService.generateForContact(userId, id, contactId);
  }
}
