import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
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
    return this.contactModel.create({ ...dto, userId });
  }

  async list(
    userId: string,
    query: ListContactsDto,
  ): Promise<{ items: Contact[]; total: number; page: number; limit: number }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const filter: FilterQuery<ContactDocument> = { userId };

    if (query.search?.trim()) {
      const escaped = escapeRegex(query.search.trim());
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
        { company: { $regex: escaped, $options: 'i' } },
        { title: { $regex: escaped, $options: 'i' } },
      ];
    }

    const sort: Record<string, 1 | -1> =
      query.sort === 'name'
        ? { name: 1, _id: 1 }
        : { createdAt: -1, _id: 1 };

    const [items, total] = await Promise.all([
      this.contactModel
        .find(filter)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.contactModel.countDocuments(filter).exec(),
    ]);

    return { items, total, page, limit };
  }

  /**
   * Look up specific contacts owned by a user. The campaigns module needs this
   * to attach/generate against contacts without reaching into the model itself.
   */
  async findOwnedByIds(userId: string, contactIds: string[]): Promise<Contact[]> {
    const objectIds = contactIds.map((id) => {
      if (!Types.ObjectId.isValid(id)) {
        throw new BadRequestException(`Invalid contact id: ${id}`);
      }
      return new Types.ObjectId(id);
    });

    return this.contactModel
      .find({ userId, _id: { $in: objectIds } })
      .lean()
      .exec();
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
