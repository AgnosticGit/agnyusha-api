import { IsInt, IsString, Min } from 'class-validator';

export class UpsertCartItemDto {
  @IsString()
  variantId!: string;

  @IsInt()
  @Min(0)
  qty!: number;
}
