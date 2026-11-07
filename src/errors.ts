/**
 * Errors shown to the user. `CliError` messages are printed as-is, without a
 * stack trace, and set the process exit code.
 */
export class CliError extends Error {
  constructor(message: string, readonly exitCode = 1) {
    super(message);
    this.name = 'CliError';
  }
}

export class ApiError extends CliError {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
