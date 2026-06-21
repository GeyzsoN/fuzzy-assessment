import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Contact, ContactDocument } from './schemas/contact.schema';
import { CreateContactDto } from './dtos/create-contact.dto';
import { ListContactsDto } from './dtos/list-contacts.dto';

@Injectable()
export class ContactsService {
  constructor(
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
  ) {}

  async create(userId: string, dto: CreateContactDto): Promise<Contact> {
    // TODO(candidate): persist a user-scoped contact.
    throw new Error('Not implemented');
  }

  async list(
    userId: string,
    query: ListContactsDto,
  ): Promise<{ items: Contact[]; total: number; page: number; limit: number }> {
    // TODO(candidate): return a STABLE paginated, searchable, sorted list scoped
    // to userId. The same contact must never appear on two pages as records are
    // added; none must be skipped. This is the most important backend detail —
    // get the sort right.
    throw new Error('Not implemented');
  }
}
