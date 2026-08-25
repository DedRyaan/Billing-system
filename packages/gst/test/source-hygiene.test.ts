import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Self-enforcing hygiene guard (02-01 Task 2): the zero-dependency and
 * single-rounding-authority mandates live in the ordinary suite, not in
 * shell grep availability. Reads every .ts file under src relative to this
 * test file's location and fails on:
 *   - the binary-float parsing builtin named in RESEARCH Pitfall 1
 *   - the Math rounding members named in RESEARCH Pitfall 2 warning signs
 *   - any runtime import/export-from specifier that does not begin with a
 *     dot (type-only imports are exempt; the engine should have none anyway)
 * The same test asserts package.json declares no `dependencies` key at all.
 */

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function listTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listTsFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

const FORBIDDEN_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/parseFloat/, 'binary-float parsing builtin (RESEARCH Pitfall 1)'],
  [/Math\.(round|ceil|floor|trunc)/, 'Math rounding builtin (RESEARCH Pitfall 2)'],
];

// import/export ... from 'specifier' — capture the module specifier.
const FROM_SPECIFIER = /\b(?:import|export)\b[^\n;]*?\bfrom\s*['"]([^'"]+)['"]/g;
// bare side-effect imports: import 'package'
const BARE_IMPORT = /^\s*import\s*['"]([^'".][^'"]*)['"]/gm;

describe('source hygiene — zero-dependency + single-rounding-authority mandates', () => {
  const srcFiles = listTsFiles(srcDir);

  it('finds src files to scan', () => {
    expect(srcFiles.length).toBeGreaterThan(0);
  });

  for (const file of srcFiles) {
    const rel = file.slice(srcDir.length + 1);

    it(`${rel}: free of forbidden builtins`, () => {
      const content = readFileSync(file, 'utf8');
      for (const [pattern, label] of FORBIDDEN_PATTERNS) {
        expect(content, `${rel} contains ${label}`).not.toMatch(pattern);
      }
    });

    it(`${rel}: every module specifier is relative (zero runtime deps)`, () => {
      const content = readFileSync(file, 'utf8');
      for (const match of content.matchAll(FROM_SPECIFIER)) {
        const lineStart = content.lastIndexOf('\n', match.index ?? 0) + 1;
        const line = content.slice(lineStart, (match.index ?? 0) + match[0].length);
        if (line.trimStart().startsWith('import type')) continue; // type-only exempt
        const specifier = match[1] ?? '';
        expect(
          specifier.startsWith('.'),
          `${rel} imports '${specifier}' — runtime imports must be relative`,
        ).toBe(true);
      }
      const bareImports = [...content.matchAll(BARE_IMPORT)];
      expect(
        bareImports,
        `${rel} contains bare package imports`,
      ).toHaveLength(0);
    });
  }

  it('package.json declares no dependencies key (structural zero-dependency mandate)', () => {
    const manifest = JSON.parse(
      readFileSync(join(srcDir, '..', 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest['dependencies']).toBeUndefined();
    expect(manifest['private']).toBe(true);
  });
});
