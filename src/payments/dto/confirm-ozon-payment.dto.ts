import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ConfirmOzonPaymentDto {
  @IsString()
  @MaxLength(64)
  orderId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  paymentId?: string;
}
