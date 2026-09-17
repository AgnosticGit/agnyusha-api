import {
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PickupDayScheduleDto {
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @IsBoolean()
  open!: boolean;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'Время должно быть в формате ЧЧ:ММ',
  })
  startTime!: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'Время должно быть в формате ЧЧ:ММ',
  })
  endTime!: string;
}

export class UpdatePickupSettingsDto {
  @IsString()
  @MinLength(3, { message: 'Укажите адрес' })
  @MaxLength(200)
  address!: string;

  @IsInt()
  @Min(0)
  @Max(30)
  minLeadDays!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PickupDayScheduleDto)
  schedule!: PickupDayScheduleDto[];
}
