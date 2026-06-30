import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class LlmQuotaUsage {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  windowStart: Date;

  @Prop({ required: true })
  windowEnd: Date;

  @Prop({ required: true, default: 0 })
  count: number;

  @Prop()
  lastUsedAt?: Date;
}

export type LlmQuotaUsageDocument = LlmQuotaUsage & Document;
export const LlmQuotaUsageSchema = SchemaFactory.createForClass(LlmQuotaUsage);

LlmQuotaUsageSchema.index({ userId: 1, windowStart: 1 }, { unique: true });
