import type { Disposer } from './plugin.js';

/** Stores services without knowing which product capability they implement. */
export class ServiceRegistry<T extends object> {
  private readonly entries = new Map<string, { value: unknown }>();

  provide<K extends keyof T & string>(name: K, service: T[K]): Disposer {
    if (this.entries.has(name)) throw new Error(`Service ${name} is already provided`);
    const entry = { value: service };
    this.entries.set(name, entry);
    return () => {
      // An old disposer must not remove a later registration of the same name.
      if (this.entries.get(name) === entry) this.entries.delete(name);
    };
  }

  get<K extends keyof T & string>(name: K): T[K] {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Service ${name} is missing`);
    return entry.value as T[K];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  clear(): void {
    this.entries.clear();
  }
}
