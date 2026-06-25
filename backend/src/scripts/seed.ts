import { faker } from '@faker-js/faker';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../app.module';
import {
  CampaignStatus,
  CampaignDocument,
  GenerationStatus,
} from '../modules/campaigns/schemas/campaign.schema';
import { CampaignRecipientDocument } from '../modules/campaigns/schemas/campaign-recipient.schema';
import { OutboxMessageDocument } from '../modules/campaigns/schemas/outbox-message.schema';
import { ContactDocument } from '../modules/contacts/schemas/contact.schema';
import { ContactGroupDocument } from '../modules/groups/schemas/contact-group.schema';
import { ContactGroupMembershipDocument } from '../modules/groups/schemas/contact-group-membership.schema';
import { UserDocument } from '../modules/users/schemas/user.schema';
import { hashPassword } from '../shared/auth/password';

const password = 'password123';

const demoUsers = [
  { name: 'Admin User', email: 'admin@fuzzy.local', role: 'admin' as const },
  { name: 'Ava Rivera', email: 'ava@fuzzy.local', role: 'user' as const },
  { name: 'Ben Carter', email: 'ben@fuzzy.local', role: 'user' as const },
  { name: 'Clara Nguyen', email: 'clara@fuzzy.local', role: 'user' as const },
];

const titles = [
  'Chief Technology Officer',
  'VP of Sales',
  'Head of Growth',
  'Revenue Operations Lead',
  'Founder',
  'Director of Marketing',
  'Product Lead',
  'Partnerships Manager',
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const userModel = app.get<Model<UserDocument>>(getModelToken('User'));
    const contactModel = app.get<Model<ContactDocument>>(getModelToken('Contact'));
    const campaignModel = app.get<Model<CampaignDocument>>(
      getModelToken('Campaign'),
    );
    const groupModel = app.get<Model<ContactGroupDocument>>(
      getModelToken('ContactGroup'),
    );
    const membershipModel = app.get<Model<ContactGroupMembershipDocument>>(
      getModelToken('ContactGroupMembership'),
    );
    const recipientModel = app.get<Model<CampaignRecipientDocument>>(
      getModelToken('CampaignRecipient'),
    );
    const outboxModel = app.get<Model<OutboxMessageDocument>>(
      getModelToken('OutboxMessage'),
    );

    const users: UserDocument[] = [];
    for (const input of demoUsers) {
      const passwordHash = await hashPassword(password);
      const user = await userModel.findOneAndUpdate(
        { email: input.email },
        { $set: { ...input, passwordHash } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      if (!user) {
        throw new Error(`Failed to upsert ${input.email}`);
      }
      users.push(user);
    }

    const userIds = users.map((user) => String(user._id));
    await contactModel.deleteMany({ userId: { $in: userIds } });
    await campaignModel.deleteMany({ userId: { $in: userIds } });
    await groupModel.deleteMany({ userId: { $in: userIds } });
    await membershipModel.deleteMany({ userId: { $in: userIds } });
    await recipientModel.deleteMany({ userId: { $in: userIds } });
    await outboxModel.deleteMany({ userId: { $in: userIds } });

    for (const [userIndex, user] of users.entries()) {
      faker.seed(20260625 + userIndex);
      const contacts = Array.from({ length: 36 }, (_, index) => {
        const name = faker.person.fullName();
        const firstName = name.split(' ')[0];
        const lastName = name.split(' ').slice(1).join(' ');
        const company = faker.company.name();
        const createdAt = new Date(
          Date.UTC(2026, 5, 25 - (index % 24), 9, index),
        );

        return {
          userId: String(user._id),
          name,
          email: faker.internet.email({
            firstName,
            lastName,
            provider: faker.internet.domainName(),
          }),
          company,
          title: titles[(index + userIndex) % titles.length],
          doNotContact: index === 35,
          createdAt,
          updatedAt: createdAt,
        };
      });

      const insertedContacts = await contactModel.insertMany(contacts);
      const [founderGroup, revenueGroup, productGroup] =
        await groupModel.insertMany([
          {
            userId: String(user._id),
            name: 'Founders and Operators',
            description: 'Founder and operator personas for early outreach.',
          },
          {
            userId: String(user._id),
            name: 'Revenue Leaders',
            description: 'Sales, growth, and revenue operations contacts.',
          },
          {
            userId: String(user._id),
            name: 'Product and Partnerships',
            description: 'Product, partnerships, and marketing contacts.',
          },
        ]);

      const memberships = [
        ...insertedContacts.slice(0, 12).map((contact) => ({
          userId: String(user._id),
          groupId: founderGroup._id,
          contactId: contact._id,
        })),
        ...insertedContacts.slice(8, 22).map((contact) => ({
          userId: String(user._id),
          groupId: revenueGroup._id,
          contactId: contact._id,
        })),
        ...insertedContacts.slice(18, 30).map((contact) => ({
          userId: String(user._id),
          groupId: productGroup._id,
          contactId: contact._id,
        })),
      ];
      await membershipModel.insertMany(memberships);

      const attachedContacts = insertedContacts
        .slice(0, 10)
        .map((contact, index) => ({
          contactId: contact._id,
          status:
            index < 3
              ? GenerationStatus.FINISHED
              : index === 3
                ? GenerationStatus.FAILED
                : GenerationStatus.NOT_GENERATED,
          generatedMessage:
            index < 3
              ? `Hi ${contact.name}, I noticed your work at ${contact.company} and thought there may be a useful angle around more targeted outbound. Open to comparing notes on first-touch personalization?`
              : undefined,
          error: index === 3 ? 'Seeded provider timeout example' : undefined,
        }));

      await campaignModel.create({
        userId: String(user._id),
        name: `${user.name.split(' ')[0]}'s Q3 Pipeline Outreach`,
        status: CampaignStatus.DRAFT,
        promptTemplate:
          'Write a concise 2-sentence LinkedIn opener for {{name}}, a {{title}} at {{company}}.',
        sequenceSteps: [
          {
            stepId: 'step-1',
            order: 1,
            delayMinutes: 0,
            subjectTemplate: 'Quick idea for {{company}}',
            promptTemplate:
              'Write a concise 2-sentence LinkedIn opener for {{name}}, a {{title}} at {{company}}.',
          },
        ],
        contacts: attachedContacts,
      });

      await campaignModel.create({
        userId: String(user._id),
        name: `${user.name.split(' ')[0]}'s Group Sequence`,
        status: CampaignStatus.DRAFT,
        promptTemplate:
          'Write a concise first email for {{name}}, a {{title}} at {{company}}.',
        targetGroupIds: [founderGroup._id, revenueGroup._id],
        directContactIds: [insertedContacts[20]._id],
        sequenceSteps: [
          {
            stepId: 'step-1',
            order: 1,
            delayMinutes: 0,
            subjectTemplate: 'Relevant idea for {{company}}',
            promptTemplate:
              'Write a concise, natural opening email for {{name}}, a {{title}} at {{company}}. Mention their company once. Max 45 words.',
          },
          {
            stepId: 'step-2',
            order: 2,
            delayMinutes: 2,
            subjectTemplate: 'Following up on {{company}}',
            promptTemplate:
              'Write a polite follow-up email for {{name}} at {{company}} referencing a prior outreach note. Max 40 words.',
          },
        ],
        contacts: [],
      });
    }

    // eslint-disable-next-line no-console
    console.log('Seeded demo users, contacts, groups, and campaigns.');
    // eslint-disable-next-line no-console
    console.table(
      demoUsers.map((user) => ({
        email: user.email,
        password,
        role: user.role,
      })),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
