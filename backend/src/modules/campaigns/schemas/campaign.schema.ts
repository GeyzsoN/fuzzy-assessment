import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Status of a single contact's generated message within a campaign.
 * (Mirrors the kind of status enum our real "magic copy" generation uses.)
 */
export enum GenerationStatus {
  NOT_GENERATED = 'not_generated',
  PENDING = 'pending',
  FINISHED = 'finished',
  FAILED = 'failed',
}

/**
 * STARTER schema. A campaign has a prompt template and a set of attached contacts,
 * each with its own generated message + status.
 *
 * TODO(candidate): model this however you think is cleanest. The embedded
 * sub-document below is a suggestion, not a requirement — you may normalize it
 * into its own collection if you prefer. Be ready to defend the choice.
 */
@Schema({ _id: false })
export class CampaignContact {
  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true })
  contactId: Types.ObjectId;

  @Prop({ type: String, enum: GenerationStatus, default: GenerationStatus.NOT_GENERATED })
  status: GenerationStatus;

  @Prop()
  generatedMessage?: string;

  @Prop()
  error?: string;
}
export const CampaignContactSchema = SchemaFactory.createForClass(CampaignContact);

@Schema({ timestamps: true })
export class Campaign {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  name: string;

  /** e.g. "Write a 2-sentence opener for {{name}}, a {{title}} at {{company}}." */
  @Prop({ required: true })
  promptTemplate: string;

  @Prop({ type: [CampaignContactSchema], default: [] })
  contacts: CampaignContact[];
}

export type CampaignDocument = Campaign & Document;
export const CampaignSchema = SchemaFactory.createForClass(Campaign);
