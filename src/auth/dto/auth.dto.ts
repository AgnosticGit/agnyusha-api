import {
  Equals,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RequestMagicLinkDto {
  @IsEmail({}, { message: 'Укажите корректный email' })
  email!: string;

  /** Required for users who have not yet accepted personal-data processing. */
  @IsOptional()
  @IsBoolean()
  privacyConsent?: boolean;
}

export class PrivacyConsentDto {
  @IsBoolean()
  @Equals(true, { message: 'Нужно согласие на обработку персональных данных' })
  privacyConsent!: boolean;
}

export class VerifyMagicLinkDto {
  @IsString()
  @MinLength(16, { message: 'Некорректная ссылка' })
  token!: string;
}

export class UpdateProfileDto {
  @IsString()
  @MinLength(5, { message: 'Укажите телефон' })
  @MaxLength(32)
  phone!: string;

  @IsString()
  @MinLength(1, { message: 'Укажите фамилию' })
  @MaxLength(80)
  lastName!: string;

  @IsString()
  @MinLength(1, { message: 'Укажите имя' })
  @MaxLength(80)
  firstName!: string;
}
