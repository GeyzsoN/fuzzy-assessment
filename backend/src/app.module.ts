import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { LlmModule } from './shared/llm/llm.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(
      process.env.MONGO_URL || 'mongodb://localhost:27017/fuzzy_assessment',
    ),
    LlmModule,
    ContactsModule,
    CampaignsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
