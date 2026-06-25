import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ _id: false })
export class RecipientSnapshot {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  email: string;

  @Prop()
  company?: string;

  @Prop()
  title?: string;
}
export const RecipientSnapshotSchema =
  SchemaFactory.createForClass(RecipientSnapshot);

@Schema({ timestamps: true })
export class CampaignRecipient {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ type: Types.ObjectId, ref: 'Campaign', required: true })
  campaignId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true })
  contactId: Types.ObjectId;

  @Prop({ type: [Types.ObjectId], ref: 'ContactGroup', default: [] })
  sourceGroupIds: Types.ObjectId[];

  @Prop({ default: false })
  direct: boolean;

  @Prop({ type: RecipientSnapshotSchema, required: true })
  snapshot: RecipientSnapshot;
}

export type CampaignRecipientDocument = CampaignRecipient & Document;
export const CampaignRecipientSchema =
  SchemaFactory.createForClass(CampaignRecipient);

CampaignRecipientSchema.index(
  { userId: 1, campaignId: 1, contactId: 1 },
  { unique: true },
);
CampaignRecipientSchema.index({ userId: 1, campaignId: 1, createdAt: 1 });
