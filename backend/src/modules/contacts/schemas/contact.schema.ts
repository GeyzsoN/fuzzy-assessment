import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * STARTER schema — extend as needed.
 *
 * TODO(candidate):
 *  - Decide required vs optional fields and types.
 *  - Add at least one index you can justify (think about how the list is queried:
 *    user-scoping, search, and sort). Be ready to explain your choice.
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

  // createdAt / updatedAt provided by `timestamps: true`
}

export type ContactDocument = Contact & Document;
export const ContactSchema = SchemaFactory.createForClass(Contact);

// TODO(candidate): add any index(es) that fit how the list endpoint queries
// this collection. Justify your choice in PLAN.md.
