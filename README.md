# Container manipulation tools

## extract_container_image

Extract container image contents to a destination directory. Uses `docker image save` and parses the resulting tarfile to write all contents, honoring whiteouts and symbolic links.
Only files, directories and symbolic links are written (no devices or hard links). All contents are written as the current user.

The container image does not need to be executable (this does not start a container to extract the contents).

This is intended as an effective way of extracting container contents for use elsewhere and doesn't attempt to guarantee full fidelity of file ownership and esoteric file types.

```
❯ deno run --allow-run --allow-read --allow-write cmd/extract_container_image.ts --help

Usage: extract_container_image <image> <directory>

Description:

  Extract the contents of a container image to a specific directory

Options:

  -h, --help     - Show this help.
  -p, --pull     - Pull image before extracting
  -v, --verbose  - Show verbose output
```

Usage example: extract the `debian:bookworm-slim` image to the `~/test` directory and confirm the contents... 

```
❯ deno run --allow-run --allow-read --allow-write cmd/extract_container_image.ts debian:bookworm-slim ~/test

❯ ls -l ~/test
total 0
lrwxr-xr-x@  1 user  staff    38 Oct  2 20:47 bin@ -> /Users/user/test/usr/bin
drwxr-xr-x@  2 user  staff    64 Oct  2 20:47 boot/
drwxr-xr-x@  2 user  staff    64 Oct  2 20:47 dev/
drwxr-xr-x@ 68 user  staff  2176 Oct  2 20:47 etc/
drwxr-xr-x@  2 user  staff    64 Oct  2 20:47 home/
lrwxr-xr-x@  1 user  staff    38 Oct  2 20:47 lib@ -> /Users/user/test/usr/lib
drwxr-xr-x@  2 user  staff    64 Oct  2 20:47 media/
drwxr-xr-x@  2 user  staff    64 Oct  2 20:47 mnt/
drwxr-xr-x@  2 user  staff    64 Oct  2 20:47 opt/
drwxr-xr-x@  2 user  staff    64 Oct  2 20:47 proc/
drwx------@  4 user  staff   128 Oct  2 20:47 root/
drwxr-xr-x@  3 user  staff    96 Oct  2 20:47 run/
lrwxr-xr-x@  1 user  staff    39 Oct  2 20:47 sbin@ -> /Users/user/test/usr/sbin
drwxr-xr-x@  2 user  staff    64 Oct  2 20:47 srv/
drwxr-xr-x@  2 user  staff    64 Oct  2 20:47 sys/
drwxrwxrwt@  2 user  staff    64 Oct  2 20:47 tmp/
drwxr-xr-x@ 11 user  staff   352 Oct  2 20:47 usr/
drwxr-xr-x@ 13 user  staff   416 Oct  2 20:47 var/
```
### Running the tool without cloning the repo

Since Deno will run scripts directly from URLs, you can also just run it like this:

```
deno run https://raw.githubusercontent.com/cwirving/containertools/main/cmd/extract_container_image.ts --help
```
