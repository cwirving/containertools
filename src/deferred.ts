export function deferred(f: () => void): Disposable {
  return {
    [Symbol.dispose]() {
      f();
    },
  };
}

export function asyncDeferred(f: () => Promise<void>): AsyncDisposable {
  return {
    [Symbol.asyncDispose]() {
      return f();
    },
  };
}
