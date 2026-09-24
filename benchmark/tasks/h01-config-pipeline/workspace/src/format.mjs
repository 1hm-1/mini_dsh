import { formatLegacy } from './legacy.mjs';

export function formatConfig(config) {
  return `${formatLegacy(config)};theme=${config.ui.theme};compact=${config.ui.compact ? 'yes' : 'no'}`;
}
