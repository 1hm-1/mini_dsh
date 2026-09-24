import type { Disposer, MiniContext, MiniPlugin } from './plugin.js';
import type { ServiceMap } from './services/index.js';
import { PluginRegistry } from './plugin-registry.js';
import { ServiceRegistry } from './service-registry.js';

export class Context implements MiniContext {
  private readonly services = new ServiceRegistry<ServiceMap>();
  private readonly plugins = new PluginRegistry(this);
  private loading = false;
  private closed = false;
  private closing?: Promise<void>;

  async use(plugin: MiniPlugin): Promise<void> {
    this.assertOpen();
    if (this.loading) throw new Error('Plugin setup is already in progress; await use before loading another plugin');
    this.loading = true;
    try {
      await this.plugins.use(plugin);
    } catch (error) {
      // PluginRegistry has already cleaned successful plugins before rejecting.
      this.services.clear();
      this.closed = true;
      throw error;
    } finally {
      this.loading = false;
    }
  }

  provide<K extends keyof ServiceMap>(name: K, service: ServiceMap[K]): Disposer {
    this.assertOpen();
    return this.services.provide(name, service);
  }

  get<K extends keyof ServiceMap>(name: K): ServiceMap[K] {
    return this.services.get(name);
  }

  has(name: string): boolean {
    return this.services.has(name);
  }

  dispose(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.closing) return this.closing;
    if (this.loading) return Promise.reject(new Error('Cannot dispose during plugin setup'));
    // Publish the closing promise before any user cleanup can run or reenter dispose.
    this.closing = Promise.resolve().then(() => this.cleanup());
    return this.closing;
  }

  private async cleanup(): Promise<void> {
    try {
      await this.plugins.dispose();
    } finally {
      this.services.clear();
      this.closed = true;
    }
  }

  private assertOpen(): void {
    if (this.closed || this.closing || this.plugins.isClosing) throw new Error('Context is closed');
  }
}
