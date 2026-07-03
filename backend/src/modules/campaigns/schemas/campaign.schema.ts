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

export enum CampaignStatus {
  GENERATING = 'generating',
  DRAFT = 'draft',
  LAUNCHING = 'launching',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Schema({ _id: false })
export class SequenceStep {
  @Prop({ required: true })
  stepId: string;

  @Prop({ required: true })
  order: number;

  @Prop({ required: true, default: 0 })
  delayMinutes: number;

  @Prop({ required: true })
  subjectTemplate: string;

  @Prop({ required: true })
  promptTemplate: string;
}
export const SequenceStepSchema = SchemaFactory.createForClass(SequenceStep);

/**
 * Embedded campaign contact state for the required per-contact generation flow.
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

  @Prop()
  generationAttemptId?: string;

  @Prop()
  generationLockedAt?: Date;
}
export const CampaignContactSchema = SchemaFactory.createForClass(CampaignContact);

@Schema({ _id: false })
export class CampaignGenerationRequest {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  templateId: string;

  @Prop({ required: true })
  goal: string;

  @Prop({ required: true })
  audienceDescription: string;

  @Prop()
  tone?: string;

  @Prop()
  maxSteps?: number;

  @Prop({ type: [String], default: [] })
  groupIds: string[];

  @Prop({ type: [String], default: [] })
  contactIds: string[];
}
export const CampaignGenerationRequestSchema =
  SchemaFactory.createForClass(CampaignGenerationRequest);

@Schema({ timestamps: true })
export class Campaign {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ type: String, enum: CampaignStatus, default: CampaignStatus.DRAFT })
  status: CampaignStatus;

  /** First-step email body template, e.g. "Hi {{first_name}}, ..." */
  @Prop()
  promptTemplate?: string;

  @Prop({ type: [Types.ObjectId], ref: 'ContactGroup', default: [] })
  targetGroupIds: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'Contact', default: [] })
  directContactIds: Types.ObjectId[];

  @Prop({ type: [SequenceStepSchema], default: [] })
  sequenceSteps: SequenceStep[];

  @Prop({ type: [CampaignContactSchema], default: [] })
  contacts: CampaignContact[];

  @Prop()
  launchedAt?: Date;

  @Prop()
  completedAt?: Date;

  @Prop()
  generationError?: string;

  @Prop()
  generatedAt?: Date;

  @Prop()
  lastAttemptedAt?: Date;

  @Prop()
  failedAt?: Date;

  @Prop()
  generationAttemptId?: string;

  @Prop()
  generationLockedAt?: Date;

  @Prop({ default: 0 })
  generationAttempts?: number;

  @Prop({ type: CampaignGenerationRequestSchema })
  generationRequest?: CampaignGenerationRequest;

  @Prop()
  idempotencyScope?: string;

  @Prop()
  idempotencyKey?: string;

  @Prop()
  idempotencyFingerprint?: string;
}

export type CampaignDocument = Campaign & Document;
export const CampaignSchema = SchemaFactory.createForClass(Campaign);

CampaignSchema.index({ userId: 1, createdAt: -1, _id: 1 });
CampaignSchema.index({ userId: 1, status: 1, createdAt: -1, _id: 1 });
CampaignSchema.index({ status: 1, generationLockedAt: 1, _id: 1 });
CampaignSchema.index(
  { userId: 1, idempotencyScope: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      idempotencyScope: { $exists: true },
      idempotencyKey: { $exists: true },
    },
  },
);
