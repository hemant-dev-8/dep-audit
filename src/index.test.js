import { describe, test, expect } from 'vitest';

// Simple integration tests that work with actual behavior
describe('dep-audit', () => {
  describe('detectPackageManager', () => {
    test('should return a valid package manager', async () => {
      const { detectPackageManager } = await import('./index.js');
      const result = await detectPackageManager();
      expect(['npm', 'yarn', 'pnpm']).toContain(result);
    });
  });

  describe('parseLockfile', () => {
    test('should handle npm manager', async () => {
      const { parseLockfile } = await import('./index.js');
      const result = await parseLockfile('npm');
      expect(result).toBeTypeOf('object');
    });

    test('should handle yarn manager', async () => {
      const { parseLockfile } = await import('./index.js');
      const result = await parseLockfile('yarn');
      expect(result).toBeTypeOf('object');
    });

    test('should handle pnpm manager', async () => {
      const { parseLockfile } = await import('./index.js');
      const result = await parseLockfile('pnpm');
      expect(result).toBeTypeOf('object');
    });
  });

  describe('function exports', () => {
    test('should export all required functions', async () => {
      const module = await import('./index.js');
      
      expect(module.detectPackageManager).toBeTypeOf('function');
      expect(module.parseLockfile).toBeTypeOf('function');
      expect(module.scan).toBeTypeOf('function');
      expect(module.unused).toBeTypeOf('function');
      expect(module.updateSuggestions).toBeTypeOf('function');
      expect(module.riskAudit).toBeTypeOf('function');
      expect(module.explainDependabot).toBeTypeOf('function');
      expect(module.autoFix).toBeTypeOf('function');
    });
  });

  describe('error handling', () => {
    test('parseLockfile should not throw for invalid manager', async () => {
      const { parseLockfile } = await import('./index.js');
      expect(() => parseLockfile('invalid')).not.toThrow();
    });
  });
});