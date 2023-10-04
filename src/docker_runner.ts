import {
  CommandRunner,
  CommandRunnerImpl,
  CommandRunOptions,
  ExtendedCommandOutput,
  SubCommandRunner,
} from "./command_runner.ts";
import { DockerImageRunner } from "./docker_image_runner.ts";

export interface DockerCommandRunnerOptions {
  /**
   * The command runner to use (defaults to `CommandRunnerImpl`).
   */
  runner?: CommandRunner;

  /**
   * The docker CLI (defaults to "docker").
   */
  cli?: string;
}

export interface DockerCommonVersionInformation {
  Version: string;
  ApiVersion: string;
  Os: string;
  Arch: string;
}

export interface DockerVersion {
  Client: DockerCommonVersionInformation;
  Server?: DockerCommonVersionInformation;
}

export class DockerCommandRunner implements SubCommandRunner {
  readonly #runner: CommandRunner;
  readonly #cli: string;
  #image?: DockerImageRunner;

  constructor(options?: DockerCommandRunnerOptions) {
    this.#runner = options?.runner ?? new CommandRunnerImpl();
    this.#cli = options?.cli ?? "docker";
  }

  runSubCommand(
    subCommand: string,
    args: string[],
    options?: CommandRunOptions,
  ): Promise<ExtendedCommandOutput> {
    return this.#runner.runCommand(
      this.#cli,
      [subCommand].concat(args),
      options,
    );
  }

  get version(): Promise<DockerVersion> {
    const outputPromise = this.runSubCommand("version", [
      "--format",
      "json",
    ]);
    return new Promise<DockerVersion>(
      (resolve: (_: DockerVersion) => void, reject: (_: unknown) => void) => {
        outputPromise
          .then((output) => resolve(JSON.parse(output.getStdout())))
          .catch((reason) => reject(reason));
      },
    );
  }

  public get image(): DockerImageRunner {
    if (!this.#image) {
      this.#image = new DockerImageRunner(this);
    }

    return this.#image;
  }
}

