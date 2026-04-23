export class CreateProductDto {
  name!: string;
  slug!: string;
  adapterType?: string;
  origins?: string[];
  hubRelay?: boolean;
  vpsId?: string;
}
