import { IsBoolean } from 'class-validator';

export class UpdateUserBanDto {
  @IsBoolean()
  banned!: boolean;
}
