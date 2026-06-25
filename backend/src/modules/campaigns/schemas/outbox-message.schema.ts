import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import {
  RecipientSnapshot,
  RecipientSnapshotSchema,
} from './campaign-recipient.schema';

export enum OutboxStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  SENT = 'sent',
  FAILED = 'failed',
}

@Schema({ timestamps: true })
export class OutboxMessage {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ type: Types.ObjectId, ref: 'Campaign', required: true })
  campaignId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true })
  contactId: Types.ObjectId;

  @Prop({ required: true })
  stepId: string;

  @Prop({ required: true })
  stepOrder: number;

  @Prop({ required: true })
  dedupeKey: string;

  @Prop({ type: RecipientSnapshotSchema, required: true })
  recipient: RecipientSnapshot;

  @Prop()
  subject?: string;

  @Prop()
  body?: string;

  @Prop({ type: String, enum: OutboxStatus, default: OutboxStatus.QUEUED })
  status: OutboxStatus;

  @Prop()
  scheduledFor?: Date;

  @Prop()
  lockedAt?: Date;

  @Prop()
  sentAt?: Date;

  @Prop({ default: 0 })
  attempts: number;

  @Prop()
  error?: string;
}

export type OutboxMessageDocument = OutboxMessage & Document;
export const OutboxMessageSchema = SchemaFactory.createForClass(OutboxMessage);

OutboxMessageSchema.index(
  { campaignId: 1, stepId: 1, contactId: 1 },
  { unique: true },
);
OutboxMessageSchema.index({ userId: 1, campaignId: 1, stepOrder: 1, status: 1 });
OutboxMessageSchema.index({ userId: 1, status: 1, scheduledFor: 1 });
