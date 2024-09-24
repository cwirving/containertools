/**
 * Inputs to a command run. Collects the parameters to the `CommandRunner` `runCommand()`
 * method as one interface so that it can be passed around in errors, etc.
 */
export interface CommandRunInput {
  readonly command: string | URL;
  readonly args: string[];
  readonly options?: CommandRunOptions;
}

/**
 * Options to the `CommandRunner` `runCommand()` method.
 * This is mostly a subset of the `Deno.CommandOptions` interface.
 */
export interface CommandRunOptions {
  /**
   * Overrides the current working directory of the child process.
   */
  readonly cwd?: string | URL;

  /**
   * If `true`, clears the process environment before merging in the `env` variables.
   */
  readonly clearEnv?: boolean;

  /**
   * Additional environment variables to pass in to the child process.
   */
  readonly env?: Record<string, string>;

  /**
   * An `AbortSignal` that can be used to terminate the child process (with `SIGTERM`).
   */
  readonly signal?: AbortSignal;
}

/**
 * A read-only extension of the `Deno.CommandOutput` interface with additional utility methods
 * to get the standard output and standard error stream contents as strings.
 */
export interface ExtendedCommandOutput extends Readonly<Deno.CommandOutput> {
  /**
   * Retrieve the contents of the standard error stream as a string.
   */
  getStderr(): string;

  /**
   * Retrieve the contents of the standard output stream as a string.
   */
  getStdout(): string;
}

/**
 * A wrapper around `Deno.CommandOutput` that implements `ExtendedCommandOutput`
 * and passes through the original interface members (only).
 */
export class CommandOutputExtender implements ExtendedCommandOutput {
  readonly code: number;
  readonly signal: Deno.Signal | null;
  readonly stderr: Uint8Array;
  readonly stdout: Uint8Array;
  readonly success: boolean;
  readonly #outputDecoder = new TextDecoder();
  #cachedStderr: string | undefined = undefined;
  #cachedStdout: string | undefined = undefined;

  constructor(output: Deno.CommandOutput) {
    this.code = output.code;
    this.signal = output.signal;
    this.stderr = output.stderr;
    this.stdout = output.stdout;
    this.success = output.success;
  }

  /**
   * Retrieve the contents of the standard error stream as a string.
   */
  getStderr(): string {
    if (this.#cachedStderr === undefined) {
      this.#cachedStderr = this.#outputDecoder.decode(this.stderr);
    }

    return this.#cachedStderr;
  }

  /**
   * Retrieve the contents of the standard output stream as a string.
   */
  getStdout(): string {
    if (this.#cachedStdout === undefined) {
      this.#cachedStdout = this.#outputDecoder.decode(this.stdout);
    }

    return this.#cachedStdout;
  }
}

/**
 * Error class thrown when the command runner fails. Implements both `CommandRunInput`
 * and `ExtendedCommandOutput` so that recipients have the full context of the failure.
 */
export class CommandRunError extends Error
  implements CommandRunInput, ExtendedCommandOutput {
  readonly #input: CommandRunInput;
  readonly #output: ExtendedCommandOutput;

  /**
   * @param input The inputs to the command that failed.
   * @param output The command output after failed exit.
   */
  constructor(input: CommandRunInput, output: ExtendedCommandOutput) {
    super(
      `Command "${input.command.toString()}" ${
        output.success ? "succeeded" : "failed"
      } with code ${output.code}`,
    );

    this.#input = input;
    this.#output = output;
  }

  /**
   * Arguments passed to the process.
   */
  get args(): string[] {
    return this.#input.args;
  }

  /**
   * Process exit code.
   */
  get code(): number {
    return this.#output.code;
  }

  /**
   * The command that was run.
   */
  get command(): string | URL {
    return this.#input.command;
  }

  /**
   * The `AbortSignal` used to potentially terminate the command.
   */
  get signal(): Deno.Signal | null {
    return this.#output.signal;
  }

  /**
   * The process standard error stream contents, as bytes.
   */
  get stderr(): Uint8Array {
    return this.#output.stderr;
  }

  /**
   * The process standard output stream contents, as bytes.
   */
  get stdout(): Uint8Array {
    return this.#output.stdout;
  }

  /**
   * If `true`, the command succeeded.
   */
  get success(): boolean {
    return this.#output.success;
  }

  /**
   * Retrieve the contents of the standard error stream as a string.
   */
  getStderr(): string {
    return this.#output.getStderr();
  }

  /**
   * Retrieve the contents of the standard output stream as a string.
   */
  getStdout(): string {
    return this.#output.getStdout();
  }
}

/**
 * Interface implemented by command runners.
 *
 * Command runners are opinionated wrappers around the Deno `Command` class that
 * are intended to run individual command subprocesses. One key difference is that they
 * throw an exception if the child process does not succeed.
 * Additionally, standard input is always null and standard output/error are both piped (captured).
 */
export interface CommandRunner {
  /**
   * Run a command, throws `CommandRunError` if the command is not successful.
   *
   * @param command The command to run.
   * @param args The arguments to pass to the command.
   * @param options Additional options for the command execution.
   */
  runCommand(
    command: string | URL,
    args: string[],
    options?: CommandRunOptions,
  ): Promise<ExtendedCommandOutput>;
}

/**
 * Similar to a command runner, but for programs that have subcommands. Subcommands are passed
 * as the first argument to the command. This is an interface for running subcommands in the
 * context of a known command.
 */
export interface SubCommandRunner {
  /**
   * Run a command, throws `CommandRunError` if the command is not successful.
   *
   * @param subCommand The subcommand to run.
   * @param args The arguments to pass to the (sub)command.
   * @param options Additional options for the (sub)command execution.   */
  runSubCommand(
    subCommand: string,
    args: string[],
    options?: CommandRunOptions,
  ): Promise<ExtendedCommandOutput>;
}

/**
 * Implementation of the `CommandRunner` interface using the Deno standard library.
 */
export class CommandRunnerImpl implements CommandRunner {
  /**
   * Run a command, throws `CommandRunError` if the command is not successful.
   *
   * @param command The command to run.
   * @param args The arguments to pass to the command.
   * @param options Additional options for the command execution.
   */
  public async runCommand(
    command: string | URL,
    args: string[],
    options?: CommandRunOptions,
  ): Promise<ExtendedCommandOutput> {
    const input: CommandRunInput = {
      command: command,
      args: args,
      options: options,
    };

    const cmd = new Deno.Command(
      command,
      {
        args: args,
        cwd: options?.cwd,
        clearEnv: options?.clearEnv,
        env: options?.env,
        signal: options?.signal,
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      },
    );

    const output = new CommandOutputExtender(await cmd.output());
    if (!output.success) {
      throw new CommandRunError(input, output);
    }

    return output;
  }
}
