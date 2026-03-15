/**
 * Restaurant context loader.
 *
 * Reads config.json + all *.md files from restaurants/<slug>/ and
 * combines them into a RestaurantConfig with a `knowledge` field.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { RestaurantConfig } from './types.js';

/**
 * Load restaurant config and markdown knowledge files.
 * @param slug - folder name under restaurants/, e.g. "delhi-darbar"
 * @param baseDir - absolute path to the project root (where restaurants/ lives)
 */
export function loadRestaurant(slug: string, baseDir: string): RestaurantConfig | null {
  const restaurantDir = join(baseDir, 'restaurants', slug);

  if (!existsSync(restaurantDir)) {
    console.warn(`[restaurant] Directory not found: ${restaurantDir}`);
    return null;
  }

  const configPath = join(restaurantDir, 'config.json');
  if (!existsSync(configPath)) {
    console.warn(`[restaurant] config.json not found in ${restaurantDir}`);
    return null;
  }

  const config: RestaurantConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

  // Load all markdown files as knowledge
  const mdFiles = readdirSync(restaurantDir)
    .filter(f => f.endsWith('.md'))
    .sort();

  const docs: string[] = [];
  for (const mdFile of mdFiles) {
    docs.push(readFileSync(join(restaurantDir, mdFile), 'utf-8'));
  }

  config.knowledge = docs.join('\n\n---\n\n');

  return config;
}
