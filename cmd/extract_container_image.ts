import { Command, Path, Streams } from "./deps.ts";
import { DockerCommandRunner } from "../src/docker_runner.ts";
import { CommandRunError } from "../src/command_runner.ts";
import { asyncDeferred, deferred } from "../src/deferred.ts";
import { Untar } from "../vendor/untar.ts";

interface ExtractContainerOptions {
  pull: boolean;
  verbose: boolean;
}

/**
 * The format of Docker saved manifest entries.
 */
interface ManifestEntry {
  Config: string;
  RepoTags: string[] | null;
  Layers: string[];
}

class LayerEntry {
  readonly layerName: string;
  readonly type: "file" | "directory" | "symlink";
  readonly path: string;
  readonly size: number;
  readonly dir: string;
  readonly base: string;
  readonly whiteout: string;
  readonly isOpaqueWhiteout: boolean;

  constructor(
    layerName: string,
    type: "file" | "directory" | "symlink",
    path: string,
    size: number,
  ) {
    this.layerName = layerName;
    this.type = type;
    this.path = path;
    this.size = size;

    const parsedPath = Path.parse("/" + path);
    this.dir = parsedPath.dir;
    this.base = parsedPath.base;

    if (parsedPath.base === ".wh..wh..opq") {
      // Opaque whiteout
      this.whiteout = parsedPath.dir;
      this.isOpaqueWhiteout = true;
    } else if (parsedPath.base.startsWith(".wh.")) {
      this.whiteout = Path.join(parsedPath.dir, parsedPath.base.substring(4));
      this.isOpaqueWhiteout = false;
    } else {
      this.whiteout = "";
      this.isOpaqueWhiteout = false;
    }
  }
}

interface LayerInformation {
  name: string;
  entries: LayerEntry[];
  loaded: boolean;
}

class UpperLayerDigest {
  readonly #whiteouts = new Set<string>();
  readonly #filePaths = new Set<string>();

  isEntryAllowed(entry: LayerEntry): boolean {
    if (this.directoryMatch(entry.dir, this.#whiteouts)) return false;

    return (entry.type !== "file") ||
      !(this.#filePaths.has(entry.path) ||
        this.#whiteouts.has("/" + entry.path));
  }

  addEntry(entry: LayerEntry): void {
    if (entry.whiteout) {
      this.#whiteouts.add(entry.whiteout);
    } else if (entry.type === "file" || entry.type === "symlink") {
      this.#filePaths.add(entry.path);
    }
  }

  /**
   * Determine whether a candidate directory path is an exact or child match for any directory in the specified set.
   * For example "/a/b/c" matches ["/a/b"], but "/a/b" does not match ["/a/b/c"].
   * @param candidate The candidate.
   * @param set A set of directories to match against.
   */
  directoryMatch(candidate: string, set: Set<string>): boolean {
    for (const item of set) {
      if (
        (candidate === item) ||
        (Path.common([candidate, item]) === item)
      ) return true;
    }
    return false;
  }

  applyDigest(info: LayerInformation): void {
    // First, filter the entries based on upper levels
    info.entries = info.entries.filter((e) => this.isEntryAllowed(e));

    // Then add the layer to the digest
    for (const entry of info.entries) {
      this.addEntry(entry);
    }
  }
}

async function extractLayers(
  tarFile: string,
  directory: string,
  layerInfo: LayerInformation[],
  verbose: boolean,
): Promise<void> {
  directory = Path.normalize(directory);

  // Build a map of path -> LayerEntry
  const names = new Set<string>();
  const entryMap = new Map<string, LayerEntry>();
  for (const layer of layerInfo) {
    // Skip empty layers.
    if (!layer.entries) continue;

    names.add(layer.name);
    for (const entry of layer.entries) {
      if (!entry.whiteout) {
        entryMap.set(entry.path, entry);
      }
    }
  }

  // Now iterate over all the layer archives and extract what is allowed
  // We can do this in any order because the layer information has been processed by the digest.
  const reader = await Deno.open(tarFile, { read: true });
  using _ = deferred(() => reader.close());
  const untar = new Untar(reader);

  for await (const entry of untar) {
    if (
      (entry.type === "file" || entry.type === "symlink") &&
      (names.has(entry.fileName))
    ) {
      if (verbose) {
        console.log(`Extracting archive ${entry.fileName}`);
      }

      const entryUntar = new Untar(entry);
      for await (const nestedEntry of entryUntar) {
        // Skip non-file, non-directory, non-symlink entries.
        if (
          nestedEntry.type !== "file" && nestedEntry.type !== "directory" &&
          nestedEntry.type !== "symlink"
        ) {
          continue;
        }
        // Skip entries that we don't need to write
        const layerEntry = entryMap.get(nestedEntry.fileName);
        if (!layerEntry) continue;

        const outputPath = Path.normalize(
          Path.join(directory, nestedEntry.fileName),
        );
        if (!outputPath.startsWith(directory)) {
          throw new Error(
            `Directory escape detected for ${nestedEntry.fileName}`,
          );
        }

        switch (layerEntry.type) {
          case "directory":
            if (verbose) {
              console.log(`Creating directory: ${outputPath}`);
            }
            await Deno.mkdir(outputPath, { recursive: true });
            if (nestedEntry.fileMode) {
              await Deno.chmod(outputPath, nestedEntry.fileMode);
            }
            break;

          case "file": {
            if (verbose) {
              console.log(`Writing file: ${outputPath}`);
            }
            const file = await Deno.open(outputPath, {
              write: true,
              create: true,
              truncate: true,
            });
            await Streams.copy(nestedEntry, file);
            file.close();
            if (nestedEntry.fileMode) {
              await Deno.chmod(outputPath, nestedEntry.fileMode);
            }
            break;
          }

          case "symlink": {
            const destination = nestedEntry.linkName;
            // Symlinks can either be absolute or relative to the link location
            const destinationPath = Path.isAbsolute(destination)
              ? Path.normalize(Path.join(directory, destination))
              : Path.normalize(
                Path.join(Path.dirname(outputPath), destination),
              );
            if (!destinationPath.startsWith(directory)) {
              throw new Error(
                `Directory escape detected for ${destinationPath}`,
              );
            }
            if (verbose) {
              console.log(`Symlink file: ${outputPath} -> ${destinationPath}`);
            }
            // symlink is not happy if the file already exists!
            try {
              await Deno.remove(outputPath);
            } catch (e) {
              // Happily ignore "not found" errors
              if (!(e instanceof Deno.errors.NotFound)) {
                throw e;
              }
            }
            await Deno.symlink(destinationPath, outputPath);
            break;
          }
        }
      }
    }
  }
}

async function parseLayerFiles(
  tarFile: string,
  names: string[],
  verbose: boolean,
): Promise<LayerInformation[]> {
  if (verbose) {
    console.log(`Parsing layer archives`);
  }
  const results = names.map<LayerInformation>((name) => {
    return { name: name, entries: [], loaded: false };
  });
  const infoMap = new Map<string, LayerInformation>();
  for (const entry of results) {
    infoMap.set(entry.name, entry);
  }

  const reader = await Deno.open(tarFile, { read: true });
  using _ = deferred(() => reader.close());
  const untar = new Untar(reader);

  for await (const entry of untar) {
    if ((entry.type === "file") && (names.includes(entry.fileName))) {
      if (verbose) {
        console.log(`Parsing archive ${entry.fileName}`);
      }

      const info = infoMap.get(entry.fileName);
      if (!info) {
        throw new Error("Internal error: Can't find layer information");
      }
      const entryUntar = new Untar(entry);
      for await (const nestedEntry of entryUntar) {
        if (
          nestedEntry.type === "directory" ||
          nestedEntry.type === "file" ||
          nestedEntry.type === "symlink"
        ) {
          info.entries.push(
            new LayerEntry(
              entry.fileName,
              nestedEntry.type,
              nestedEntry.fileName,
              nestedEntry.fileSize ?? 0,
            ),
          );
        }
      }
      info.loaded = true;
    }
  }

  if (results.find((info) => !info.loaded)) {
    throw new Error("Could not find information for all layers");
  }

  return results;
}

async function getArchiveManifest(
  tarFile: string,
  verbose: boolean,
): Promise<ManifestEntry[]> {
  if (verbose) {
    console.log(`Parsing archive contents`);
  }
  const reader = await Deno.open(tarFile, { read: true });
  using _ = deferred(() => reader.close());
  const untar = new Untar(reader);

  for await (const entry of untar) {
    if ((entry.type === "file") && (entry.fileName === "manifest.json")) {
      if (verbose) {
        console.log("Loading manifest");
      }

      const rawManifest = await Streams.toJson(
        Streams.readableStreamFromReader(entry),
      );
      if (!Array.isArray(rawManifest)) {
        throw new TypeError("Archive manifest is not an array as expected");
      }

      return rawManifest as ManifestEntry[];
    }
  }

  throw new Error("Archive has no manifest");
}

async function extractContainerImage(
  options: ExtractContainerOptions,
  image: string,
  directory: string,
): Promise<void> {
  try {
    const docker = new DockerCommandRunner();

    if (options.pull) {
      if (options.verbose) {
        console.log(`Pulling image ${image}`);
      }
      const pullResult = await docker.image.pull(image, { quiet: true });

      image = pullResult.getStdout().trim();
      if (options.verbose) {
        console.log(`using actual image name: ${image}`);
      }
    }

    // Save the container image tar archive to a temporary file.
    const tarFile = await Deno.makeTempFile();
    await using _ = asyncDeferred(() => Deno.remove(tarFile));
    if (options.verbose) {
      console.log(`Saving image archive to ${tarFile}`);
    }
    const saveResult = await docker.image.save(image, { output: tarFile });

    const dockerRepoPrefix = "docker.io/library/";
    const shortImageName = image.startsWith(dockerRepoPrefix) ? image.substring(dockerRepoPrefix.length) : image;

    // Parse the archive and read its manifest.
    const manifest = await getArchiveManifest(tarFile, options.verbose);
    const mainEntry = manifest.find((e) =>
      (e.RepoTags != null) && (e.RepoTags.includes(shortImageName))
    );
    if (!mainEntry) {
      throw new Error("Archive manifest does not contain image tag");
    }

    // Get the raw layer contents (before whiteout processing)
    const layerInfo = await parseLayerFiles(
      tarFile,
      mainEntry.Layers,
      options.verbose,
    );

    // Apply whiteouts and duplicate file removal
    const digest = new UpperLayerDigest();
    for (const info of layerInfo.toReversed()) {
      digest.applyDigest(info);
    }

    if (options.verbose) {
      for (const layer of layerInfo) {
        console.log(layer.name);
        console.group();
        for (const entry of layer.entries) {
          console.log(entry.type, entry.path);
        }
        console.groupEnd();
      }
    }

    await extractLayers(tarFile, directory, layerInfo, options.verbose);
  } catch (e) {
    if (e instanceof CommandRunError) {
      console.error(e.command, e.args.join(" "));
      console.error(e.getStderr());
    }
    throw e;
  }
}

await new Command()
  .name("extract_container_image")
  .description(
    "Extract the contents of a container image to a specific directory",
  )
  .arguments("<image:string> <directory:string>")
  .option("-p, --pull", "Pull image before extracting")
  .option("-v, --verbose", "Show verbose output")
  .action((options, image, directory) =>
    extractContainerImage(
      { pull: !!options.pull, verbose: !!options.verbose },
      image,
      directory,
    )
  )
  .parse(Deno.args);
