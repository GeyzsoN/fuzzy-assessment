import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dtos/create-campaign.dto';
import { UpdateCampaignDto } from './dtos/update-campaign.dto';
import { AttachContactsDto } from './dtos/attach-contacts.dto';
import { GenerateCampaignDraftDto } from './dtos/generate-campaign-draft.dto';
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

  @Post('generate-draft')
  generateDraft(
    @CurrentUser() userId: string,
    @Body() dto: GenerateCampaignDraftDto,
  ) {
    return this.campaignsService.generateDraft(userId, dto);
  }

  @Get()
  list(@CurrentUser() userId: string) {
    return this.campaignsService.list(userId);
  }

  @Patch(':id')
  update(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaignsService.update(userId, id, dto);
  }

  @Get(':id')
  getOne(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.campaignsService.getOne(userId, id);
  }

  @Delete(':id')
  remove(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.campaignsService.remove(userId, id);
  }

  @Post(':id/launch')
  launch(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.campaignsService.launch(userId, id);
  }

  @Post(':id/generate-sequence')
  generateSequence(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.campaignsService.generateSequence(userId, id);
  }

  @Get(':id/outbox')
  getOutbox(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.campaignsService.getOutbox(userId, id);
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
