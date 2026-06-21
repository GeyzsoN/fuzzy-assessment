import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ContactsService } from './contacts.service';
import { Contact } from './schemas/contact.schema';

/**
 * STARTER test. Replace/extend with a meaningful spec — the pagination/list logic
 * is the most valuable thing to cover here (stable ordering, search, scoping).
 *
 * You can mock the model as below, or stand up an in-memory Mongo if you prefer.
 */
describe('ContactsService', () => {
  let service: ContactsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ContactsService,
        {
          provide: getModelToken(Contact.name),
          useValue: {
            // TODO(candidate): mock the methods your service actually uses.
          },
        },
      ],
    }).compile();

    service = moduleRef.get(ContactsService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  // TODO(candidate): test stable pagination + search + user scoping.
});
