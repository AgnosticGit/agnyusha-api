import { IsEmail, IsString, MinLength } from 'class-validator';

export class RequestMagicLinkDto {
  @IsEmail({}, { message: 'Укажите корректный email' })
  email!: string;
}

export class VerifyMagicLinkDto {
  @IsString()
  @MinLength(16, { message: 'Некорректная ссылка' })
  token!: string;
}
