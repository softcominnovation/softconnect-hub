export class UpdateProductDto {
  name?: string;
  slug?: string;
  adapterType?: string;
  origins?: string[];
  hubRelay?: boolean;
  vpsId?: string;
  isActive?: boolean;
}
