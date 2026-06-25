import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * User-scoped contact schema. Indexes below support deterministic list ordering,
 * user-scoped search/sort, and per-user email uniqueness.
 */
@Schema({ timestamps: true })
export class Contact {
  /** The owning user (from x-user-id). Resources must be scoped to this. */
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  email: string;

  @Prop()
  company?: string;

  @Prop()
  title?: string;

  @Prop({ default: false })
  doNotContact?: boolean;

  // createdAt / updatedAt provided by `timestamps: true`
}

export type ContactDocument = Contact & Document;
export const ContactSchema = SchemaFactory.createForClass(Contact);

ContactSchema.index({ userId: 1, createdAt: -1, _id: 1 });
ContactSchema.index({ userId: 1, name: 1, _id: 1 });
ContactSchema.index({ userId: 1, email: 1 }, { unique: true });
