export interface CommandRunInput {
  command: string | URL;
  args: string[];
  options?: CommandRunOptions;
}

export interface CommandRunOptions {
  cwd?: string | URL;
  clearEnv?: boolean;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ExtendedCommandOutput extends Deno.CommandOutput {
  getStdout(): string;
  getStderr(): string;
}

export class CommandOutputExtender implements ExtendedCommandOutput {
  readonly code: number;
  readonly signal: Deno.Signal | null;
  readonly stderr: Uint8Array;
  readonly stdout: Uint8Array;
  success: boolean;
  #outputDecoder = new TextDecoder();
  #cachedStderr: string | undefined = undefined;
  #cachedStdout: string | undefined = undefined;

  constructor(output: Deno.CommandOutput) {
    this.code = output.code;
    this.signal = output.signal;
    this.stderr = output.stderr;
    this.stdout = output.stdout;
    this.success = output.success;
  }

  getStderr(): string {
    if (this.#cachedStderr === undefined) {
      this.#cachedStderr = this.#outputDecoder.decode(this.stderr);
    }

    return this.#cachedStderr;
  }

  getStdout(): string {
    if (this.#cachedStdout === undefined) {
      this.#cachedStdout = this.#outputDecoder.decode(this.stdout);
    }

    return this.#cachedStdout;
  }
}

export class CommandRunError extends Error
  implements CommandRunInput, ExtendedCommandOutput {
  readonly #input: CommandRunInput;
  readonly #output: ExtendedCommandOutput;

  constructor(input: CommandRunInput, output: ExtendedCommandOutput) {
    super(
      `Command "${input.command.toString()}" ${
        output.success ? "succeeded" : "failed"
      } with code ${output.code}`,
    );

    this.#input = input;
    this.#output = output;
  }

  get args(): string[] {
    return this.#input.args;
  }

  get code(): number {
    return this.#output.code;
  }

  get command(): string | URL {
    return this.#input.command;
  }

  get signal(): Deno.Signal | null {
    return this.#output.signal;
  }

  get stderr(): Uint8Array {
    return this.#output.stderr;
  }

  get stdout(): Uint8Array {
    return this.#output.stdout;
  }

  get success(): boolean {
    return this.#output.success;
  }

  getStderr(): string {
    return this.#output.getStderr();
  }

  getStdout(): string {
    return this.#output.getStdout();
  }
}

export interface CommandRunner {
  runCommand(
    command: string | URL,
    args: string[],
    options?: CommandRunOptions,
  ): Promise<ExtendedCommandOutput>;
}

export interface SubCommandRunner {
  runSubCommand(
    subCommand: string,
    args: string[],
    options?: CommandRunOptions,
  ): Promise<ExtendedCommandOutput>;
}

export class CommandRunnerImpl implements CommandRunner {
  public async runCommand(
    command: string | URL | null,
    args: string[],
    options?: CommandRunOptions,
  ): Promise<ExtendedCommandOutput> {
    // This runner has no default command, so we throw an exception if the command is `null`.
    if (command === null) {
      throw new TypeError("CommandRunnerImpl:run() -- command is null");
    }

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
