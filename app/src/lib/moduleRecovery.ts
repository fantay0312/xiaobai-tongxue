export function isModuleLoadFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk .* failed|Unable to preload CSS/i.test(message);
}

export async function retryModule<T>(load: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await load(); }
    catch (error) {
      if (!isModuleLoadFailure(error) || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, [400, 1_000][attempt]));
    }
  }
}

export function recoverModuleLoad(error: unknown): void {
  window.dispatchEvent(new CustomEvent('xiaobai:module-load-error', { detail: error }));
}
