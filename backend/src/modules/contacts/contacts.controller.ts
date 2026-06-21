import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dtos/create-contact.dto';
import { ListContactsDto } from './dtos/list-contacts.dto';
import { UserGuard } from '../../shared/auth/user.guard';
import { CurrentUser } from '../../shared/auth/current-user.decorator';

@Controller('contacts')
@UseGuards(UserGuard)
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateContactDto) {
    return this.contactsService.create(userId, dto);
  }

  @Get()
  list(@CurrentUser() userId: string, @Query() query: ListContactsDto) {
    return this.contactsService.list(userId, query);
  }
}
