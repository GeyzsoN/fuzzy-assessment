import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ContactGroup,
  ContactGroupSchema,
} from './schemas/contact-group.schema';
import {
  ContactGroupMembership,
  ContactGroupMembershipSchema,
} from './schemas/contact-group-membership.schema';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { ContactsModule } from '../contacts/contacts.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ContactGroup.name, schema: ContactGroupSchema },
      {
        name: ContactGroupMembership.name,
        schema: ContactGroupMembershipSchema,
      },
    ]),
    ContactsModule,
  ],
  controllers: [GroupsController],
  providers: [GroupsService],
  exports: [GroupsService],
})
export class GroupsModule {}
