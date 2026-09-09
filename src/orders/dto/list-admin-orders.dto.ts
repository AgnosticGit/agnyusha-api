import { IsEnum, IsOptional } from 'class-validator';
import { OrderStatus } from '@prisma/client';
import { SearchPaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListAdminOrdersDto extends SearchPaginationQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}
