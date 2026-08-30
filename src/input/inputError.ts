export class InputFileError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'InputFileError';
    this.status = status;
  }
}
