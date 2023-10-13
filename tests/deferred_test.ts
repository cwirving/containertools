import { asyncDeferred, deferred } from "../src/deferred.ts";
import { assert } from "./deps.ts";

Deno.test("deferred() creates a Disposable object", testDeferred);
function testDeferred(): void {
  let done = false;

  const d = deferred(() => {
    done = true;
  });

  d[Symbol.dispose]();

  assert(done);
}

Deno.test(
  "asyncDeferred() creates a AsyncDisposable object",
  testAsyncDeferred,
);
async function testAsyncDeferred(): Promise<void> {
  let done = false;

  const d = asyncDeferred(() => {
    done = true;
    return Promise.resolve();
  });

  await d[Symbol.asyncDispose]();

  assert(done);
}
