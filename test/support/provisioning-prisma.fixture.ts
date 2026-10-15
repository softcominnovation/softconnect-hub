// Stateful persistence double for the existing HTTP/timeout regression suites.
// Concurrency and SQL guarantees are tested separately against PostgreSQL.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
export function provisionPersistence<T>(target: T): T {
  const prisma = target as any;
  prisma.instance.findMany ??= jest.fn(async (args) => {
    const row = await prisma.instance.findFirst(args);
    return row ? [row] : [];
  });
  prisma.$transaction = jest.fn((work) => work(prisma));
  let operation: any;
  let instance: any;
  prisma.$queryRaw = jest.fn().mockResolvedValue([{ id: 'fixture' }]);
  prisma.product.findUniqueOrThrow = jest.fn(async (args) =>
    prisma.product.findUnique(args),
  );
  prisma.product.updateMany = jest.fn();
  prisma.vpsProvider.findUniqueOrThrow = jest.fn(async (args) => ({
    ...(await prisma.vpsProvider.findUnique(args)),
    acceptingNewInstances: true,
    maxInstances: null,
    vps: { isActive: true },
  }));
  prisma.vpsProvider.update = jest.fn();
  prisma.productEvolution.findUnique = jest
    .fn()
    .mockResolvedValue({ acceptingNewInstances: true });
  prisma.evolutionInventoryEntry = {
    findFirst: jest.fn(),
    deleteMany: jest.fn(),
  };
  prisma.instanceProvisioning = {
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn(async () => operation),
    findUniqueOrThrow: jest.fn(async () => operation),
    create: jest.fn(async ({ data }) => {
      operation = { id: 'intent-fixture', state: 'reserved', ...data };
      return operation;
    }),
    update: jest.fn(async ({ data }) => {
      operation = { ...operation, ...data };
      return operation;
    }),
  };
  const create = prisma.instance.create;
  prisma.instance.create = jest.fn(async (args) => {
    const result = await create(args);
    instance = { ...args.data, ...result };
    return result;
  });
  // Keep tests free to replace create's implementation and inspect its calls.
  prisma.instance.findUniqueOrThrow = jest.fn(async () => instance);
  prisma.instance.findUnique = jest.fn(async (args) => {
    if (args.where.id && prisma.instance.create.mock.results.length) {
      const last = prisma.instance.create.mock.results.at(-1);
      return {
        ...prisma.instance.create.mock.calls.at(-1)[0].data,
        ...(await last.value),
      };
    }
    return prisma.instance.findFirst(args);
  });
  return target;
}
