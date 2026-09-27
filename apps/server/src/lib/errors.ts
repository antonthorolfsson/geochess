/** An error with an HTTP status whose message is safe to show to players. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string, code?: string) => new HttpError(400, message, code);
export const unauthorized = (message = 'Sign in to continue.') => new HttpError(401, message, 'unauthorized');
export const forbidden = (message = "You can't do that.") => new HttpError(403, message, 'forbidden');
export const notFound = (message = 'Not found.') => new HttpError(404, message, 'not-found');
export const conflict = (message: string, code?: string) => new HttpError(409, message, code);
