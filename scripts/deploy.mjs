#!/usr/bin/env node
/**
 * Deploy built files to Obsidian vault plugin folder.
 * Reads OBSIDIAN_VAULT from .env.local or environment.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Load .env.local
const envPath = join(ROOT, '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^([^=]+)=["']?(.+?)["']?$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

const vault = process.env.OBSIDIAN_VAULT;
if (!vault || !existsSync(vault)) {
  console.error('Set OBSIDIAN_VAULT in .env.local to deploy');
  process.exit(1);
}

const pluginDir = join(vault, '.obsidian', 'plugins', 'cassandra-obsidian');
if (!existsSync(pluginDir)) mkdirSync(pluginDir, { recursive: true });

for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  const src = join(ROOT, file);
  if (existsSync(src)) {
    copyFileSync(src, join(pluginDir, file));
    console.log(`Deployed ${file}`);
  }
}

console.log(`Deployed to ${pluginDir}`);
