import type { ServiceMap } from './services/index.js';

export type Disposer = () => void | Promise<void>;
export interface MiniPlugin {
  name: string;
  dependencies?: string[];
  setup(ctx: MiniContext): void | Disposer | Promise<void | Disposer>;
}
export interface MiniContext {
  use(plugin: MiniPlugin): Promise<void>;
  provide<K extends keyof ServiceMap>(name: K, service: ServiceMap[K]): Disposer;
  get<K extends keyof ServiceMap>(name: K): ServiceMap[K];
  has(name: string): boolean;
  dispose(): Promise<void>;
}
