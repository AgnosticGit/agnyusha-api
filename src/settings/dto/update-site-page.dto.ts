import { IsString, MaxLength } from 'class-validator';

export class UpdateSitePageDto {
  @IsString()
  @MaxLength(100_000)
  contentHtml!: string;
}
