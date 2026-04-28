import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Product } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { CacheService } from '../../../cache/cache.service';
import { generateApiKey, hashSHA256 } from '../../../common/crypto.util';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

type SafeProduct = Omit<Product, 'apiKeyHash'>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async create(
    dto: CreateProductDto,
  ): Promise<SafeProduct & { apiKey: string }> {
    const apiKey = generateApiKey();
    const apiKeyHash = hashSHA256(apiKey);

    try {
      const product = await this.prisma.product.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          apiKeyHash,
          adapterType: dto.adapterType ?? 'evolution',
          origins: dto.origins ?? [],
          hubRelay: dto.hubRelay ?? false,
          vpsId: dto.vpsId ?? null,
        },
      });

      return { ...this.stripHash(product), apiKey };
    } catch (err) {
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('A product with this slug already exists');
      }
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new UnprocessableEntityException(
          'vpsId inválido: VPS não encontrada',
        );
      }
      throw err;
    }
  }

  async findAll(): Promise<SafeProduct[]> {
    return this.prisma.product.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        adapterType: true,
        origins: true,
        hubRelay: true,
        isActive: true,
        vpsId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async update(id: string, dto: UpdateProductDto): Promise<SafeProduct> {
    await this.assertExists(id);

    try {
      const updated = await this.prisma.product.update({
        where: { id },
        data: dto,
      });

      await this.cache.del(`auth:${updated.apiKeyHash}`);
      return this.stripHash(updated);
    } catch (err) {
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new UnprocessableEntityException(
          'vpsId inválido: VPS não encontrada',
        );
      }
      throw err;
    }
  }

  async deactivate(id: string): Promise<SafeProduct> {
    await this.assertExists(id);

    const updated = await this.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });

    await this.cache.del(`auth:${updated.apiKeyHash}`);
    return this.stripHash(updated);
  }

  private stripHash(product: Product): SafeProduct {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { apiKeyHash, ...safe } = product;
    return safe;
  }

  private async assertExists(id: string): Promise<void> {
    const exists = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(`Produto ${id} não encontrado`);
  }
}
