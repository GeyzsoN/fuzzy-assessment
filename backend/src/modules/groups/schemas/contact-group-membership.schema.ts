import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class ContactGroupMembership {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ type: Types.ObjectId, ref: 'ContactGroup', required: true })
  groupId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true })
  contactId: Types.ObjectId;
}

export type ContactGroupMembershipDocument = ContactGroupMembership & Document;
export const ContactGroupMembershipSchema = SchemaFactory.createForClass(
  ContactGroupMembership,
);

ContactGroupMembershipSchema.index(
  { userId: 1, groupId: 1, contactId: 1 },
  { unique: true },
);
ContactGroupMembershipSchema.index({ userId: 1, contactId: 1, groupId: 1 });
