import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ _id: false })
export class CampaignTemplateStep {
  @Prop({ required: true })
  order: number;

  @Prop({ required: true, default: 0 })
  delayDays: number;

  @Prop({ required: true })
  subjectTemplate: string;

  @Prop({ required: true })
  promptTemplate: string;
}
export const CampaignTemplateStepSchema =
  SchemaFactory.createForClass(CampaignTemplateStep);

@Schema({ timestamps: true })
export class CampaignTemplate {
  @Prop({ required: true, unique: true, index: true })
  key: string;

  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop({ required: true, default: 3 })
  defaultMaxSteps: number;

  @Prop({ required: true, default: 'sequence-draft-v1' })
  promptTemplateKey: string;

  @Prop({ type: [CampaignTemplateStepSchema], default: [] })
  steps: CampaignTemplateStep[];
}

export type CampaignTemplateDocument = CampaignTemplate & Document;
export const CampaignTemplateSchema =
  SchemaFactory.createForClass(CampaignTemplate);

@Schema({ timestamps: true })
export class PromptTemplate {
  @Prop({ required: true, unique: true, index: true })
  key: string;

  @Prop({ required: true })
  name: string;

  @Prop()
  purpose?: string;

  @Prop({ required: true })
  systemPrompt: string;

  @Prop({ required: true })
  userPrompt: string;
}

export type PromptTemplateDocument = PromptTemplate & Document;
export const PromptTemplateSchema = SchemaFactory.createForClass(PromptTemplate);
