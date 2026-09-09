import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { MailSend, SendMailInput } from './mail.tokens';

@Injectable()
export class ResendMailService {
  private readonly logger = new Logger(ResendMailService.name);
  private readonly client: Resend | null;
  private readonly from: string;
  private readonly driver: string;

  constructor(private readonly config: ConfigService) {
    this.driver = (this.config.get<string>('MAIL_DRIVER') ?? 'resend').trim();
    this.from = (this.config.get<string>('MAIL_FROM') ?? '')
      .trim()
      .replace(/^["']|["']$/g, '');
    const apiKey = (this.config.get<string>('RESEND_API_KEY') ?? '').trim();
    this.client = apiKey ? new Resend(apiKey) : null;

    if (this.from && /[^\x00-\x7F]/.test(this.from)) {
      this.logger.warn(
        'MAIL_FROM contains non-ASCII characters; Resend will reject it. Use ASCII, e.g. Agnyusha <onboarding@resend.dev>',
      );
    }
  }

  send: MailSend = async (input: SendMailInput) => {
    if (this.driver !== 'resend') {
      throw new Error(`Unsupported MAIL_DRIVER: ${this.driver}`);
    }
    if (!this.from) {
      throw new Error('MAIL_FROM is not configured');
    }

    if (!this.client) {
      this.logger.warn(
        `RESEND_API_KEY missing — mail not sent to ${input.to} (token omitted from logs)`,
      );
      return;
    }

    const result = await this.client.emails.send({
      from: this.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(input.attachments?.length
        ? {
            attachments: input.attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              contentId: a.contentId,
              contentType: a.contentType,
            })),
          }
        : {}),
    });

    if (result.error) {
      this.logger.error(`Resend error: ${result.error.message}`);
      throw new Error('Не удалось отправить письмо');
    }
  };
}
