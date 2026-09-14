import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  AdminPromosController,
  PublicPromosController,
} from './promos.controller';
import { PromosService } from './promos.service';

@Module({
  imports: [AuthModule],
  controllers: [PublicPromosController, AdminPromosController],
  providers: [PromosService],
  exports: [PromosService],
})
export class PromosModule {}
