import type { Disposer, MiniContext, MiniPlugin } from './plugin.js';

/** Loads plugins in caller order and cleans up only successfully loaded plugins. */
export class PluginRegistry {
  private readonly loaded: { name: string; cleanup?: Disposer }[] = [];
  private readonly names = new Set<string>();
  private loading = false;
  private disposed = false;
  private closing?: Promise<void>;

  constructor(private readonly ctx: MiniContext) {}

  get isClosing(): boolean {
    return this.disposed || this.closing !== undefined;
  }

  async use(plugin: MiniPlugin): Promise<void> {
    if (this.disposed || this.closing) throw new Error('Plugin registry is closed');
    if (this.loading) throw new Error('Plugin setup is already in progress; await use before loading another plugin');
    this.loading = true;
    try {
      if (this.names.has(plugin.name)) throw new Error(`Plugin ${plugin.name} is already loaded`);
      for (const dependency of plugin.dependencies ?? []) {
        if (!this.ctx.has(dependency)) throw new Error(`Plugin ${plugin.name} is missing dependency service ${dependency}`);
      }
      const cleanup = await plugin.setup(this.ctx);
      this.loaded.push({ name: plugin.name, ...(cleanup ? { cleanup } : {}) });
      this.names.add(plugin.name);
    } catch (error) {
      this.loading = false;
      // Startup failure remains the primary error. Independent dispose reports cleanup errors.
      try { await this.dispose(); } catch { /* preserve startup error */ }
      throw error;
    } finally {
      this.loading = false;
    }
  }

  dispose(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.closing) return this.closing;
    if (this.loading) return Promise.reject(new Error('Cannot dispose during plugin setup'));
    // Publish the closing promise before any user cleanup can run or reenter dispose.
    this.closing = Promise.resolve().then(() => this.cleanup());
    return this.closing;
  }

  private async cleanup(): Promise<void> {
    let failed = false;
    let firstError: unknown;
    try {
      while (this.loaded.length > 0) {
        const plugin = this.loaded.pop()!;
        try { await plugin.cleanup?.(); } catch (error) {
          if (!failed) { firstError = error; failed = true; }
        }
      }
    } finally {
      this.names.clear();
      this.disposed = true;
    }
    if (failed) throw firstError;
  }
}
