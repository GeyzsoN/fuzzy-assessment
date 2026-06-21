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
    // TODO(candidate): return a paginated, searchable, sorted list scoped to
    // userId. Make the ordering deterministic so paging is consistent.
    throw new Error('Not implemented');
  }

  /**
   * Look up specific contacts owned by a user. The campaigns module needs this
   * to attach/generate against contacts without reaching into the model itself.
   * TODO(candidate): implement (return only contacts whose userId matches).
   */
  async findOwnedByIds(userId: string, contactIds: string[]): Promise<Contact[]> {
    throw new Error('Not implemented');
  }
}
