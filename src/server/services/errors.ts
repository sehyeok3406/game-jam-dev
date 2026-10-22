/** Service failure; the transport maps status/code/lifecycle onto the existing wire format. */
export class ApiError extends Error {
  code?: string;
  lifecycle?: unknown;
  readonly status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}
