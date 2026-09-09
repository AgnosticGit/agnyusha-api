import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { ManageUsersGuard, type AuthedRequest } from '../auth/auth.guard';
import { ListUsersDto } from './dto/list-users.dto';
import { UpdateUserBanDto } from './dto/update-ban.dto';
import { UpdateUserRoleDto } from './dto/update-role.dto';
import { UsersService } from './users.service';

class ListUsersQueryDto extends ListUsersDto {
  @IsOptional()
  @IsString()
  @IsIn(['clients', 'staff'])
  category?: 'clients' | 'staff';
}

@Controller('admin/users')
@UseGuards(ManageUsersGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list({
      q: query.q,
      page: query.page,
      limit: query.limit,
      category: query.category,
    });
  }

  @Patch(':id/role')
  setRole(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: UpdateUserRoleDto,
  ) {
    return this.users.setRole(
      req.user!.id,
      req.user!.role,
      id,
      body.role,
      body.permissions,
    );
  }

  @Patch(':id/ban')
  setBan(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: UpdateUserBanDto,
  ) {
    return this.users.setBanned(req.user!.id, req.user!.role, id, body.banned);
  }

  @Delete(':id')
  remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.users.remove(req.user!.id, req.user!.role, id);
  }
}
