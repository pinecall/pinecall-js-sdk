/**
 * CliError — user-facing error that prints a clean message without a stack trace.
 *
 * Throw this from any CLI library function instead of calling process.exit().
 * The entry point catches it and prints the message.
 */
export class CliError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CliError";
    }
}
