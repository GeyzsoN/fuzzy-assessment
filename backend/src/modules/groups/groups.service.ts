import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ContactGroup,
  ContactGroupDocument,
} from './schemas/contact-group.schema';
import {
  ContactGroupMembership,
  ContactGroupMembershipDocument,
} from './schemas/contact-group-membership.schema';
import { CreateGroupDto } from './dtos/create-group.dto';
import { AddGroupContactsDto } from './dtos/add-group-contacts.dto';
import { ContactsService } from '../contacts/contacts.service';

@Injectable()
export class GroupsService {
  constructor(
    @InjectModel(ContactGroup.name)
    private readonly groupModel: Model<ContactGroupDocument>,
    @InjectModel(ContactGroupMembership.name)
    private readonly membershipModel: Model<ContactGroupMembershipDocument>,
    private readonly contactsService: ContactsService,
  ) {}

  async create(userId: string, dto: CreateGroupDto) {
    try {
      const group = await this.groupModel.create({ ...dto, userId });
      return { ...group.toObject(), _id: String(group._id), memberCount: 0 };
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new BadRequestException('A group with this name already exists');
      }
      throw error;
    }
  }

  async list(userId: string) {
    const groups = await this.groupModel
      .find({ userId })
      .sort({ createdAt: -1, _id: 1 })
      .lean()
      .exec();
    const counts = await this.membershipModel.aggregate<{
      _id: Types.ObjectId;
      count: number;
    }>([
      { $match: { userId } },
      { $group: { _id: '$groupId', count: { $sum: 1 } } },
    ]);
    const countsByGroup = new Map(
      counts.map((entry) => [String(entry._id), entry.count]),
    );

    return groups.map((group: any) => ({
      ...group,
      _id: String(group._id),
      memberCount: countsByGroup.get(String(group._id)) || 0,
    }));
  }

  async getOne(userId: string, groupId: string) {
    const group = await this.requireGroup(userId, groupId);
    const memberships = await this.membershipModel
      .find({ userId, groupId: group._id })
      .sort({ createdAt: -1, _id: 1 })
      .lean()
      .exec();
    const contactIds = memberships.map((membership) =>
      String(membership.contactId),
    );
    const contacts = contactIds.length
      ? await this.contactsService.findOwnedByIds(userId, contactIds)
      : [];
    const contactsById = new Map(
      contacts.map((contact: any) => [String(contact._id), contact]),
    );

    return {
      ...group.toObject(),
      _id: String(group._id),
      contacts: contactIds
        .map((contactId) => contactsById.get(contactId))
        .filter(Boolean),
      memberCount: contactIds.length,
    };
  }

  async addContacts(userId: string, groupId: string, dto: AddGroupContactsDto) {
    const group = await this.requireGroup(userId, groupId);
    const uniqueContactIds = [...new Set(dto.contactIds)];
    const contacts = await this.contactsService.findOwnedByIds(
      userId,
      uniqueContactIds,
    );
    if (contacts.length !== uniqueContactIds.length) {
      throw new BadRequestException('One or more contacts were not found');
    }

    if (contacts.length) {
      await this.membershipModel.bulkWrite(
        contacts.map((contact: any) => ({
          updateOne: {
            filter: {
              userId,
              groupId: group._id,
              contactId: contact._id,
            },
            update: {
              $setOnInsert: {
                userId,
                groupId: group._id,
                contactId: contact._id,
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    }

    return this.getOne(userId, groupId);
  }

  async removeContact(userId: string, groupId: string, contactId: string) {
    const group = await this.requireGroup(userId, groupId);
    if (!Types.ObjectId.isValid(contactId)) {
      throw new BadRequestException('Invalid contact id');
    }

    await this.membershipModel
      .deleteOne({
        userId,
        groupId: group._id,
        contactId: new Types.ObjectId(contactId),
      })
      .exec();

    return this.getOne(userId, groupId);
  }

  async findMembershipsForGroups(userId: string, groupIds: string[]) {
    const objectIds = groupIds.map((id) => {
      if (!Types.ObjectId.isValid(id)) {
        throw new BadRequestException(`Invalid group id: ${id}`);
      }
      return new Types.ObjectId(id);
    });

    if (!objectIds.length) {
      return [];
    }

    const groups = await this.groupModel
      .find({ userId, _id: { $in: objectIds } })
      .lean()
      .exec();
    if (groups.length !== new Set(groupIds).size) {
      throw new BadRequestException('One or more groups were not found');
    }

    return this.membershipModel
      .find({ userId, groupId: { $in: objectIds } })
      .lean()
      .exec();
  }

  private async requireGroup(userId: string, groupId: string) {
    if (!Types.ObjectId.isValid(groupId)) {
      throw new BadRequestException('Invalid group id');
    }

    const group = await this.groupModel.findOne({ userId, _id: groupId });
    if (!group) {
      throw new NotFoundException('Group not found');
    }
    return group;
  }
}

function isDuplicateKey(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: number }).code === 11000
  );
}
