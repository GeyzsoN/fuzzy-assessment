import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dtos/create-group.dto';
import { AddGroupContactsDto } from './dtos/add-group-contacts.dto';
import { UserGuard } from '../../shared/auth/user.guard';
import { CurrentUser } from '../../shared/auth/current-user.decorator';

@Controller('groups')
@UseGuards(UserGuard)
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateGroupDto) {
    return this.groupsService.create(userId, dto);
  }

  @Get()
  list(@CurrentUser() userId: string) {
    return this.groupsService.list(userId);
  }

  @Get(':id')
  getOne(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.groupsService.getOne(userId, id);
  }

  @Post(':id/contacts')
  addContacts(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: AddGroupContactsDto,
  ) {
    return this.groupsService.addContacts(userId, id, dto);
  }

  @Delete(':id/contacts/:contactId')
  removeContact(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Param('contactId') contactId: string,
  ) {
    return this.groupsService.removeContact(userId, id, contactId);
  }
}
