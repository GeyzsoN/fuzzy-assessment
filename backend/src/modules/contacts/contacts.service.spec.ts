import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ContactsService } from './contacts.service';
import { Contact } from './schemas/contact.schema';

describe('ContactsService', () => {
  let service: ContactsService;
  let model: {
    create: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
  };
  let findChain: {
    sort: jest.Mock;
    skip: jest.Mock;
    limit: jest.Mock;
    lean: jest.Mock;
    exec: jest.Mock;
  };

  beforeEach(async () => {
    findChain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([{ name: 'Ada Lovelace' }]),
    };
    model = {
      create: jest.fn(),
      find: jest.fn().mockReturnValue(findChain),
      countDocuments: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(1) }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ContactsService,
        {
          provide: getModelToken(Contact.name),
          useValue: model,
        },
      ],
    }).compile();

    service = moduleRef.get(ContactsService);
  });

  it('uses a total order for createdAt pagination', async () => {
    const result = await service.list('user-1', {
      page: 2,
      limit: 5,
      sort: 'createdAt',
    });

    expect(model.find).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(findChain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: 1 });
    expect(findChain.skip).toHaveBeenCalledWith(5);
    expect(findChain.limit).toHaveBeenCalledWith(5);
    expect(result).toEqual({
      items: [{ name: 'Ada Lovelace' }],
      total: 1,
      page: 2,
      limit: 5,
    });
  });

  it('escapes search text and uses _id as the name sort tie-breaker', async () => {
    await service.list('user-2', {
      page: 1,
      limit: 20,
      search: 'Acme.*',
      sort: 'name',
    });

    expect(model.find).toHaveBeenCalledWith({
      userId: 'user-2',
      $or: [
        { name: { $regex: 'Acme\\.\\*', $options: 'i' } },
        { email: { $regex: 'Acme\\.\\*', $options: 'i' } },
        { company: { $regex: 'Acme\\.\\*', $options: 'i' } },
        { title: { $regex: 'Acme\\.\\*', $options: 'i' } },
      ],
    });
    expect(findChain.sort).toHaveBeenCalledWith({ name: 1, _id: 1 });
  });

  it('turns duplicate contact emails into a 400 instead of an unhandled 500', async () => {
    model.create.mockRejectedValue({ code: 11000 });

    await expect(
      service.create('user-1', {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
      }),
    ).rejects.toThrow('A contact with this email already exists.');
  });
});
