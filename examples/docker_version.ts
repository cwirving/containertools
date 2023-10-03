import { DockerCommandRunner } from "../src/docker_runner.ts";

const runner = new DockerCommandRunner();

const version = await runner.version;

console.log(JSON.stringify(version, null, 2));
