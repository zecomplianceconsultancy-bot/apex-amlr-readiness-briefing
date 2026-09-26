export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = () => new HttpError(401, "unauthorized", "Niet ingelogd.");
export const forbidden = (msg = "Onvoldoende rechten.") => new HttpError(403, "forbidden", msg);
export const notFound = (what = "Resource") => new HttpError(404, "not_found", `${what} niet gevonden.`);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, "bad_request", msg, details);
