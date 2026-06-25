import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class ContactGroup {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;
}

export type ContactGroupDocument = ContactGroup & Document;
export const ContactGroupSchema = SchemaFactory.createForClass(ContactGroup);

ContactGroupSchema.index({ userId: 1, name: 1 }, { unique: true });
ContactGroupSchema.index({ userId: 1, createdAt: -1, _id: 1 });
