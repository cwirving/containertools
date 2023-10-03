import { CommandRunOptions, ExtendedCommandOutput, SubCommandRunner } from "./command_runner.ts";
import { Promise } from "https://esm.sh/v111/ioredis@5.3.1/deno/ioredis.js";

/**
 * Options for the `docker image build` command.
 */
export interface DockerImageBuildOptions {
  target?: string;
}

export interface DockerImagePullOptions {
  /**
   * Pull all tags (instead of the specified/latest one.
   */
  allTags?: boolean;

  /**
   * Disable content verification.
   */
  disableContentTrust?: boolean;

  /**
   * The target platform.
   */
  platform?: string;

  /**
   * Don't show progress.
   */
  quiet?: boolean;
}

/**
 * Options for the `docker image save` command.
 */
export interface DockerImageSaveOptions {
  /**
   * The path of the file to write to.
   */
  output?: string;
}


export class DockerImageRunner implements SubCommandRunner {
  readonly #parentRunner: SubCommandRunner;

  constructor(parentRunner: SubCommandRunner) {
    this.#parentRunner = parentRunner;
  }

  public runSubCommand(
    subCommand: string,
    args: string[],
    options?: CommandRunOptions,
  ): Promise<ExtendedCommandOutput> {
    return this.#parentRunner.runSubCommand(
      "image",
      [subCommand].concat(args),
      options,
    );
  }

  public build(context: string | URL, options?: DockerImageBuildOptions) {
    if(typeof context !== "string") {
      context = context.toString();
    }

    const args: string[] = [];
    if(options?.target){
      args.push("--target", options.target);
    }

    return this.runSubCommand("build", args);
  }

  public pull(imageName: string, options?: DockerImagePullOptions): Promise<ExtendedCommandOutput> {
    const args: string[] = [];
    if(typeof options?.allTags === "boolean") {
      args.push(`--all-tags=${options.allTags.toString()}`);
    }
    if(typeof options?.disableContentTrust === "boolean") {
      args.push(`--disable-content-trust=${options.disableContentTrust.toString()}`);
    }
    if(typeof options?.platform === "string") {
      args.push("--platform", options.platform);
    }
    if(typeof options?.quiet === "boolean") {
      args.push(`--quiet=${options.quiet.toString()}`);
    }

    return this.runSubCommand("pull", args.concat(imageName));
  }

  public save(imageName: string, options?: DockerImageSaveOptions): Promise<ExtendedCommandOutput> {
    const args: string[] = [];
    if(options?.output){
      args.push("--output", options.output);
    }

    return this.runSubCommand("save", args.concat(imageName));
  }
}
