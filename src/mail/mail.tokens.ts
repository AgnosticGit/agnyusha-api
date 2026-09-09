export const MAIL_SEND = Symbol('MAIL_SEND');

export type MailAttachment = {
  filename: string;
  /** Base64-encoded content for Resend. */
  content: string;
  contentId?: string;
  contentType?: string;
};

export type SendMailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
};

export type MailSend = (input: SendMailInput) => Promise<void>;
