import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import {
  AuthGuard,
  ReviewsAccessGuard,
  type AuthedRequest,
} from '../auth/auth.guard';
import { CreateReviewDto, UpdateAdminReviewDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';

class AdminReviewsQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('products/:idOrSlug/reviews')
  list(@Param('idOrSlug') idOrSlug: string) {
    return this.reviews.listForProduct(idOrSlug);
  }

  @Get('me/reviews/eligible')
  @UseGuards(AuthGuard)
  eligible(@Req() req: AuthedRequest) {
    return this.reviews.listEligibleForUser(req.user!.id);
  }

  @Get('me/reviews')
  @UseGuards(AuthGuard)
  mine(@Req() req: AuthedRequest) {
    return this.reviews.listMine(req.user!.id);
  }

  @Get('products/:idOrSlug/reviews/can-review')
  @UseGuards(AuthGuard)
  async canReview(
    @Param('idOrSlug') idOrSlug: string,
    @Req() req: AuthedRequest,
  ) {
    const list = await this.reviews.listForProduct(idOrSlug);
    const allowed = await this.reviews.canUserReview(req.user!.id, list.productId);
    return { canReview: allowed };
  }

  @Post('products/:idOrSlug/reviews')
  @UseGuards(AuthGuard)
  create(
    @Param('idOrSlug') idOrSlug: string,
    @Req() req: AuthedRequest,
    @Body() body: CreateReviewDto,
  ) {
    return this.reviews.create(req.user!.id, idOrSlug, body);
  }

  @Get('admin/reviews')
  @UseGuards(ReviewsAccessGuard)
  adminList(@Query() query: AdminReviewsQueryDto) {
    return this.reviews.adminList(query);
  }

  @Patch('admin/reviews/:id')
  @UseGuards(ReviewsAccessGuard)
  adminUpdate(@Param('id') id: string, @Body() body: UpdateAdminReviewDto) {
    return this.reviews.adminUpdate(id, body);
  }

  @Delete('admin/reviews/:id')
  @UseGuards(ReviewsAccessGuard)
  adminDelete(@Param('id') id: string) {
    return this.reviews.adminDelete(id);
  }
}
