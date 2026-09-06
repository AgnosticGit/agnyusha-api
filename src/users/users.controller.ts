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
import { AdminGuard, type AuthedRequest } from '../auth/auth.guard';
import { ListUsersDto } from './dto/list-users.dto';
import { UpdateUserBanDto } from './dto/update-ban.dto';
import { UpdateUserRoleDto } from './dto/update-role.dto';
import { UsersService } from './users.service';

@Controller('admin/users')
@UseGuards(AdminGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query() query: ListUsersDto) {
    return this.users.list({
      q: query.q,
      page: query.page,
      limit: query.limit,
    });
  }

  @Patch(':id/role')
  setRole(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: UpdateUserRoleDto,
  ) {
    return this.users.setRole(req.user!.id, id, body.role);
  }

  @Patch(':id/ban')
  setBan(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: UpdateUserBanDto,
  ) {
    return this.users.setBanned(req.user!.id, id, body.banned);
  }

  @Delete(':id')
  remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.users.remove(req.user!.id, id);
  }
}
