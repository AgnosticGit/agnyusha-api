export const MAIL_SEND = Symbol('MAIL_SEND');

export type SendMailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type MailSend = (input: SendMailInput) => Promise<void>;
