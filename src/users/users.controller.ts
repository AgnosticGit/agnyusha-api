import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard, type AuthedRequest } from '../auth/auth.guard';
import { UpdateUserRoleDto } from './dto/update-role.dto';
import { UsersService } from './users.service';

@Controller('admin/users')
@UseGuards(AdminGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Patch(':id/role')
  setRole(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: UpdateUserRoleDto,
  ) {
    return this.users.setRole(req.user!.id, id, body.role);
  }
}
