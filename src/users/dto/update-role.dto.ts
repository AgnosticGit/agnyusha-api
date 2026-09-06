import { IsArray, IsEnum, IsOptional } from 'class-validator';
import { StaffPermission, UserRole } from '@prisma/client';

export class UpdateUserRoleDto {
  @IsEnum(UserRole)
  role!: UserRole;

  @IsOptional()
  @IsArray()
  @IsEnum(StaffPermission, { each: true })
  permissions?: StaffPermission[];
}
