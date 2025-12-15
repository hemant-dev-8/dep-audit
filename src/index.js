#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { promises as fs } from "fs";
import path from "path";
import { execSync } from "child_process";
import { promisify } from "util";
import { exec } from "child_process";
import depcheck from "depcheck";
import semver from "semver";
import Table from "cli-table3";
import lockfile from "@yarnpkg/lockfile";
import yaml from "yaml";

const execAsync = promisify(exec);

// Utility functions
const safeJsonParse = (content, fallback = {}) => {
  try {
    return JSON.parse(content);
  } catch {
    return fallback;
  }
};

const sanitizePackageName = (name) => {
  // Only allow valid npm package name characters
  const isValid = /^[@a-z0-9._/-]+$/i.test(name);
  if (!isValid) {
    console.debug(`Invalid package name detected: "${name}"`);
  }
  return isValid ? name : null;
};

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

// Package manager detection with better error handling
const detectPackageManager = async () => {
  const cwd = process.cwd();
  const lockFiles = [
    { file: "yarn.lock", manager: "yarn" },
    { file: "pnpm-lock.yaml", manager: "pnpm" },
    { file: "package-lock.json", manager: "npm" }
  ];

  for (const { file, manager } of lockFiles) {
    if (await fileExists(path.join(cwd, file))) {
      return manager;
    }
  }
  return "npm";
};

// Enhanced lockfile parsing with proper error handling
const parseLockfile = async (manager) => {
  const cwd = process.cwd();
  const lockFiles = {
    npm: "package-lock.json",
    yarn: "yarn.lock", 
    pnpm: "pnpm-lock.yaml"
  };

  const lockFile = lockFiles[manager];
  if (!lockFile) {
    console.warn(chalk.yellow(`Unknown package manager: ${manager}`));
    return { dependencies: {} };
  }

  const lockPath = path.join(cwd, lockFile);
  if (!(await fileExists(lockPath))) return { dependencies: {} };

  try {
    const content = await fs.readFile(lockPath, "utf8");
    
    switch (manager) {
      case "npm":
        return parseNpmLock(content);
      case "yarn":
        return parseYarnLock(content);
      case "pnpm":
        return parsePnpmLock(content);
      default:
        return { dependencies: {} };
    }
  } catch (err) {
    console.warn(chalk.yellow(`Failed to parse ${lockFile}: ${err.message}`));
    return { dependencies: {} };
  }
};

const parseNpmLock = (content) => {
  const lock = safeJsonParse(content);
  const deps = {};
  const visited = new Set();

  const walk = (node, depth = 0, path = "") => {
    if (depth > 100 || visited.has(path)) return;
    visited.add(path);

    Object.entries(node || {}).forEach(([name, info]) => {
      if (info?.version) {
        deps[name] = { version: info.version };
      }
      if (info?.dependencies) {
        walk(info.dependencies, depth + 1, `${path}/${name}`);
      }
    });
  };

  walk(lock.dependencies);
  return { dependencies: deps };
};

const parseYarnLock = (content) => {
  try {
    const parsed = lockfile.parse(content);
    const deps = {};

    Object.entries(parsed.object || {}).forEach(([key, value]) => {
      const names = key.split(",")
        .map(k => k.trim().split("@")[0])
        .filter(name => name.length > 0);
      
      names.forEach(name => {
        if (value?.version) {
          deps[name] = { version: value.version };
        }
      });
    });

    return { dependencies: deps };
  } catch (err) {
    throw new Error(`Yarn lockfile parsing failed: ${err.message}`);
  }
};

const parsePnpmLock = (content) => {
  try {
    const parsed = yaml.parse(content);
    const deps = {};

    Object.keys(parsed.packages || {}).forEach(key => {
      if (!key.startsWith("/")) return;

      const withoutSlash = key.slice(1);
      const atIndex = withoutSlash.startsWith("@") 
        ? withoutSlash.indexOf("@", 1)
        : withoutSlash.lastIndexOf("@");
      
      if (atIndex === -1) return;

      const name = withoutSlash.slice(0, atIndex);
      const version = withoutSlash.slice(atIndex + 1);
      deps[name] = { version };
    });

    return { dependencies: deps };
  } catch (err) {
    throw new Error(`PNPM lockfile parsing failed: ${err.message}`);
  }
};

// Safe command execution with package name validation
const safeExecCommand = async (manager, action, packageName, extraArgs = '') => {
  // Validate package name first
  if (!sanitizePackageName(packageName)) {
    throw new Error(`Invalid package name: ${packageName}`);
  }
  
  // Build command based on manager and action
  let command;
  if (action === 'view') {
    command = `${manager} ${manager === 'yarn' ? 'info' : 'view'} ${packageName} ${extraArgs}`.trim();
  } else if (action === 'ls') {
    command = `${manager} ${manager === 'yarn' ? 'list' : 'ls'} ${packageName} ${extraArgs}`.trim();
  } else {
    throw new Error(`Unsupported action: ${action}`);
  }
  
  try {
    const { stdout } = await execAsync(command);
    return stdout.trim();
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Command not found: ${manager}`);
    }
    throw new Error(`Command failed: ${err.message}`);
  }
};

// Enhanced scan function
const scan = async (opts = {}) => {
  const pkgPath = path.resolve(process.cwd(), "package.json");
  
  if (!(await fileExists(pkgPath))) {
    throw new Error("package.json not found");
  }

  const content = await fs.readFile(pkgPath, "utf8");
  const pkg = safeJsonParse(content);
  
  if (!pkg.name) {
    throw new Error("Invalid package.json: missing name field");
  }

  const manager = await detectPackageManager();
  const lock = await parseLockfile(manager);

  const result = {
    manager,
    dependencies: pkg.dependencies || {},
    devDependencies: pkg.devDependencies || {},
    optionalDependencies: pkg.optionalDependencies || {},
    peerDependencies: pkg.peerDependencies || {},
    lockfileDependencies: lock.dependencies || {},
  };

  if (opts.json) return result;

  const table = new Table({
    head: [chalk.cyan("Type"), chalk.cyan("Count"), chalk.cyan("Packages")],
    style: { head: [], border: [] },
  });

  const depTypes = [
    ["Dependencies", result.dependencies],
    ["Dev Dependencies", result.devDependencies],
    ["Optional", result.optionalDependencies],
    ["Peer", result.peerDependencies],
    [`Lockfile (${manager})`, result.lockfileDependencies]
  ];

  depTypes.forEach(([type, deps]) => {
    const packages = Object.keys(deps);
    table.push([
      type,
      packages.length,
      packages.length > 5 ? `${packages.slice(0, 5).join(", ")}...` : packages.join(", ")
    ]);
  });

  console.log(table.toString());
  return result;
};

// Enhanced unused dependencies detection
const unused = async (opts = {}) => {
  const manager = await detectPackageManager();
  
  if (manager !== "npm") {
    console.warn(chalk.yellow(`Depcheck primarily supports npm; results for ${manager} may be incomplete.`));
  }

  try {
    const result = await depcheck(process.cwd(), {
      ignoreBinPackage: false,
      skipMissing: false,
    });

    const unusedDeps = [
      ...(result.dependencies || []),
      ...(result.devDependencies || []),
    ];

    if (opts.json) return unusedDeps;

    if (unusedDeps.length === 0) {
      console.log(chalk.green("No unused dependencies found! 🎉"));
      return [];
    }

    console.log(chalk.yellow("Unused dependencies:"));
    const table = new Table({
      head: [chalk.yellow("Package")],
      style: { head: [], border: [] },
    });
    
    unusedDeps.forEach(dep => table.push([dep]));
    console.log(table.toString());

    // Manager-specific removal commands
    const removeCmd = {
      npm: "npm uninstall",
      yarn: "yarn remove", 
      pnpm: "pnpm remove"
    }[manager];

    console.log(chalk.cyan("\nSuggested removal commands:"));
    unusedDeps.forEach(dep => {
      console.log(chalk.cyan(`  ${removeCmd} ${dep}`));
    });

    return unusedDeps;
  } catch (err) {
    console.error(chalk.red(`Depcheck failed: ${err.message}`));
    return [];
  }
};

// Enhanced update suggestions with better error handling
const updateSuggestions = async (opts = {}) => {
  const pkgPath = path.resolve(process.cwd(), "package.json");
  
  if (!(await fileExists(pkgPath))) {
    throw new Error("package.json not found");
  }

  const content = await fs.readFile(pkgPath, "utf8");
  const pkg = safeJsonParse(content);
  const manager = await detectPackageManager();
  const lock = await parseLockfile(manager);

  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.optionalDependencies,
  };

  const suggestions = [];

  for (const [name, range] of Object.entries(allDeps)) {
    if (!sanitizePackageName(name)) {
      console.warn(chalk.yellow(`Skipping invalid package name: ${name}`));
      continue;
    }

    try {
      let currentVer = lock.dependencies?.[name]?.version;
      if (!currentVer || !semver.valid(currentVer)) {
        try {
          const output = await safeExecCommand(manager, 'ls', name, '--json --depth=0');
          const lsData = safeJsonParse(output);
          currentVer = lsData.dependencies?.[name]?.version || range;
        } catch {
          currentVer = range;
        }
      }

      const latestOutput = await safeExecCommand(manager, 'view', name, 'version --json');
      const latestData = safeJsonParse(latestOutput);
      const latestVer = typeof latestData === "string" ? latestData : latestData.version;

      if (!latestVer) {
        console.warn(chalk.yellow(`Skipping ${name}: No version found`));
        continue;
      }

      if (semver.eq(currentVer, latestVer)) continue;

      let currentSem, latestSem;
      try {
        currentSem = semver.parse(currentVer);
        latestSem = semver.parse(latestVer);
        if (!currentSem || !latestSem) {
          console.warn(chalk.yellow(`Skipping ${name}: Invalid version format`));
          continue;
        }
      } catch (err) {
        console.warn(chalk.yellow(`Skipping ${name}: Version parsing failed - ${err.message}`));
        continue;
      }
      
      let type = "PATCH";
      if (latestSem.major > currentSem.major) type = "MAJOR";
      else if (latestSem.minor > currentSem.minor) type = "MINOR";

      if (opts.safe && type === "MAJOR") continue;

      const installCmd = {
        npm: "npm install",
        yarn: "yarn add",
        pnpm: "pnpm add"
      }[manager];

      suggestions.push({
        name,
        current: currentVer,
        latest: latestVer,
        type,
        command: `${installCmd} ${name}@${latestVer}`,
      });
    } catch (err) {
      console.warn(chalk.yellow(`Skipping ${name}: ${err.message}`));
    }
  }

  if (opts.json) return suggestions;

  if (suggestions.length === 0) {
    console.log(chalk.green("All dependencies are up to date! 🎉"));
    return [];
  }

  const table = new Table({
    head: [
      chalk.cyan("Package"),
      chalk.cyan("Current"),
      chalk.cyan("Latest"),
      chalk.cyan("Type"),
      chalk.cyan("Command"),
    ],
    style: { head: [], border: [] },
  });

  suggestions.forEach(dep => {
    const color = dep.type === "MAJOR" ? chalk.red : dep.type === "MINOR" ? chalk.yellow : chalk.green;
    table.push([
      color(dep.name),
      dep.current,
      dep.latest,
      color(`(${dep.type})`),
      chalk.cyan(dep.command),
    ]);
  });

  console.log(table.toString());
  return suggestions;
};

// Risk audit with enhanced scoring
const riskAudit = async (opts = {}) => {
  const pkgPath = path.resolve(process.cwd(), "package.json");
  
  if (!(await fileExists(pkgPath))) {
    throw new Error("package.json not found");
  }

  const content = await fs.readFile(pkgPath, "utf8");
  const pkg = safeJsonParse(content);
  const manager = await detectPackageManager();

  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.optionalDependencies,
  };

  let auditOutput = {};
  try {
    const auditCmd = manager === "yarn" ? "yarn audit --json" : "npm audit --json";
    const { stdout } = await execAsync(auditCmd, { cwd: process.cwd() });
    auditOutput = safeJsonParse(stdout);
  } catch (err) {
    console.warn(chalk.yellow(`${manager} audit failed, skipping CVE check: ${err.message}`));
  }

  const results = [];

  for (const [name] of Object.entries(allDeps)) {
    if (!sanitizePackageName(name)) continue;

    try {
      const commandResults = await Promise.allSettled([
        safeExecCommand(manager, 'view', name, 'time --json').then(output => safeJsonParse(output)),
        safeExecCommand(manager, 'view', name, 'maintainers --json').then(output => safeJsonParse(output)),
        safeExecCommand(manager, 'view', name, 'weeklyDownloads --json').then(output => safeJsonParse(output))
      ]);
      
      const [timeData, maintainers, downloads] = commandResults.map(result => 
        result.status === 'fulfilled' ? result.value : {}
      );

      const latestTime = timeData.modified || timeData.created || timeData.latest || new Date().toISOString();
      const numMaintainers = Array.isArray(maintainers) ? maintainers.length : 0;
      const weeklyDownloads = typeof downloads === "number" ? downloads : 0;

      const hasVuln = auditOutput.vulnerabilities?.[name] || 
        Object.values(auditOutput.vulnerabilities || {}).some(v => v.name === name);

      // Enhanced scoring algorithm
      let score = 10;
      const now = new Date();
      const lastUpdate = new Date(latestTime);
      const monthsSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60 * 24 * 30);

      if (monthsSinceUpdate > 24) score -= 3;
      else if (monthsSinceUpdate > 12) score -= 2;
      if (numMaintainers <= 1) score -= 2;
      if (weeklyDownloads < 1000) score -= 2;
      if (hasVuln) score -= 3;

      score = Math.max(0, score);

      let level = "LOW";
      const reasons = [];

      if (score <= 3) {
        level = "HIGH";
        reasons.push("High risk package");
      } else if (score <= 6) {
        level = "MEDIUM";
        reasons.push("Medium risk package");
      } else {
        reasons.push("Generally healthy");
      }

      if (monthsSinceUpdate > 12) reasons.push(`Last updated ${Math.round(monthsSinceUpdate)} months ago`);
      if (numMaintainers <= 1) reasons.push("Few maintainers");
      if (weeklyDownloads < 1000) reasons.push("Low weekly downloads");
      if (hasVuln) reasons.push("Known vulnerabilities");

      results.push({ name, level, score, reason: reasons.join(", ") });
    } catch (err) {
      console.warn(chalk.yellow(`Skipping ${name}: ${err.message}`));
    }
  }

  if (opts.json) return results;

  if (results.length === 0) {
    console.log(chalk.green("No dependencies to audit."));
    return [];
  }

  results.sort((a, b) => b.score - a.score);

  const table = new Table({
    head: [
      chalk.cyan("Package"),
      chalk.cyan("Risk Level"),
      chalk.cyan("Score"),
      chalk.cyan("Reasons"),
    ],
    style: { head: [], border: [] },
  });

  results.forEach(dep => {
    const color = dep.level === "HIGH" ? chalk.red : dep.level === "MEDIUM" ? chalk.yellow : chalk.green;
    table.push([dep.name, color(dep.level), color(dep.score), dep.reason]);
  });

  console.log(table.toString());

  const highCount = results.filter(r => r.level === "HIGH").length;
  const medCount = results.filter(r => r.level === "MEDIUM").length;
  console.log(chalk.cyan(`\nSummary: ${highCount} HIGH, ${medCount} MEDIUM, ${results.length - highCount - medCount} LOW`));
  
  return results;
};

// Enhanced Dependabot explanation
const explainDependabot = async (opts = {}) => {
  const pkgPath = path.resolve(process.cwd(), "package.json");
  const manager = await detectPackageManager();
  const lockFiles = {
    npm: "package-lock.json",
    yarn: "yarn.lock",
    pnpm: "pnpm-lock.yaml"
  };

  const lockPath = path.resolve(process.cwd(), lockFiles[manager]);
  
  if (!(await fileExists(pkgPath)) || !(await fileExists(lockPath))) {
    throw new Error(`Missing package.json or ${lockFiles[manager]}`);
  }

  const pkgContent = await fs.readFile(pkgPath, "utf8");
  const pkg = safeJsonParse(pkgContent);
  const lock = await parseLockfile(manager);

  const issues = [];

  // Version mismatch detection
  ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].forEach(depType => {
    Object.entries(pkg[depType] || {}).forEach(([dep, reqRange]) => {
      const lockedVersion = lock.dependencies?.[dep]?.version;
      if (lockedVersion && !semver.satisfies(lockedVersion, reqRange)) {
        const installCmd = {
          npm: "npm install",
          yarn: "yarn add",
          pnpm: "pnpm add"
        }[manager];

        issues.push({
          type: "VERSION_MISMATCH",
          message: `${dep} in ${depType} requires ${reqRange}, but locked at ${lockedVersion}.`,
          fix: `${installCmd} ${dep}@${reqRange}`,
          severity: "HIGH",
        });
      }
    });
  });

  // Peer dependency conflicts
  try {
    const lsCmd = manager === "yarn" ? "yarn list --json" : "npm ls --json --depth=0";
    const { stdout, stderr } = await execAsync(lsCmd, { cwd: process.cwd() });
    
    if (stderr?.includes("peer") || stderr?.includes("conflict")) {
      issues.push({
        type: "PEER_CONFLICT",
        message: "Potential peer dependency conflicts detected.",
        fix: `Run ${manager} install --legacy-peer-deps or add resolutions`,
        severity: "MEDIUM",
      });
    }
  } catch (err) {
    console.warn(chalk.yellow(`Could not check peer deps: ${err.message}`));
  }

  if (opts.json) return { issues };

  if (issues.length === 0) {
    console.log(chalk.green("No obvious Dependabot issues found! 🚀"));
    return { issues: [] };
  }

  const table = new Table({
    head: [
      chalk.cyan("Issue"),
      chalk.cyan("Severity"),
      chalk.cyan("Message"),
      chalk.cyan("Fix"),
    ],
    style: { head: [], border: [] },
  });

  issues.forEach(issue => {
    const color = issue.severity === "HIGH" ? chalk.red : chalk.yellow;
    table.push([
      color(issue.type),
      color(issue.severity),
      issue.message,
      chalk.cyan(issue.fix),
    ]);
  });

  console.log(table.toString());

  const highIssues = issues.filter(i => i.severity === "HIGH").length;
  console.log(chalk.cyan(`\n${highIssues} HIGH severity issues.`));
  
  return { issues };
};

// Auto-fix functionality
const autoFix = async (opts = {}) => {
  const fixes = [];

  try {
    const unusedDeps = await unused({ json: true });
    if (unusedDeps.length > 0) {
      const manager = await detectPackageManager();
      const removeCmd = {
        npm: "npm uninstall",
        yarn: "yarn remove",
        pnpm: "pnpm remove"
      }[manager];

      fixes.push({
        type: "UNUSED_DEPS",
        description: `Remove ${unusedDeps.length} unused dependencies`,
        command: unusedDeps.map(dep => `${removeCmd} ${dep}`).join(" && "),
        packages: unusedDeps
      });
    }
  } catch (err) {
    console.warn(chalk.yellow(`Could not check unused deps: ${err.message}`));
  }

  try {
    const { issues } = await explainDependabot({ json: true });
    const syncIssues = issues.filter(i => i.type === "VERSION_MISMATCH");
    if (syncIssues.length > 0) {
      const manager = await detectPackageManager();
      const installCmd = {
        npm: "npm install",
        yarn: "yarn install", 
        pnpm: "pnpm install"
      }[manager];

      fixes.push({
        type: "LOCKFILE_SYNC",
        description: `Fix ${syncIssues.length} version mismatches`,
        command: installCmd,
        issues: syncIssues
      });
    }
  } catch (err) {
    console.warn(chalk.yellow(`Could not check lockfile: ${err.message}`));
  }

  if (opts.json) return fixes;

  if (fixes.length === 0) {
    console.log(chalk.green("No fixes needed! 🎉"));
    return [];
  }

  const table = new Table({
    head: [chalk.cyan("Fix Type"), chalk.cyan("Description"), chalk.cyan("Command")],
    style: { head: [], border: [] }
  });

  fixes.forEach(fix => {
    table.push([fix.type, fix.description, chalk.cyan(fix.command)]);
  });

  console.log(table.toString());

  if (opts.dryRun) {
    console.log(chalk.yellow("\n🔍 Dry run mode - no changes applied"));
    console.log(chalk.cyan("Run without --dry-run to apply fixes"));
  } else {
    console.log(chalk.red("\n⚠️  Auto-apply not implemented yet"));
    console.log(chalk.cyan("Run commands manually for now"));
  }

  return fixes;
};

// CLI setup
const program = new Command();

program
  .name("dep-audit")
  .description("Advanced dependency auditor CLI for npm/yarn/pnpm")
  .version("2.0.0")
  .option("-j, --json", "Output as JSON");

program.addHelpText("after", "\nExamples:\n  dep-audit scan\n  dep-audit unused\n  dep-audit update\n  dep-audit risk\n  dep-audit dependabot\n  dep-audit scan --json");

// Commands
program
  .command("scan")
  .description("Scan package.json and lockfile")
  .action(async () => {
    const spinner = ora("Scanning dependencies...").start();
    try {
      spinner.stop();
      await scan({ json: program.opts().json });
      console.log(chalk.green("✓ Scan complete"));
    } catch (err) {
      spinner.fail("Scan failed");
      console.error(chalk.red(err.message));
      process.exit(1);
    }
  });

program
  .command("unused")
  .description("Detect unused dependencies")
  .action(async () => {
    const spinner = ora("Checking for unused deps...").start();
    try {
      spinner.stop();
      await unused({ json: program.opts().json });
      console.log(chalk.green("✓ Unused check complete"));
    } catch (err) {
      spinner.fail("Check failed");
      console.error(chalk.red(err.message));
      process.exit(1);
    }
  });

program
  .command("update")
  .description("Suggest safe dependency updates")
  .option("--safe", "Only suggest non-breaking updates")
  .action(async (cmd) => {
    const spinner = ora("Checking for updates...").start();
    try {
      spinner.stop();
      await updateSuggestions({ json: program.opts().json, safe: cmd.safe });
      console.log(chalk.green("✓ Update check complete"));
    } catch (err) {
      spinner.fail("Update check failed");
      console.error(chalk.red(err.message));
      process.exit(1);
    }
  });

program
  .command("risk")
  .description("Analyze dependency health & risk")
  .action(async () => {
    const spinner = ora("Running risk audit...").start();
    try {
      spinner.stop();
      await riskAudit({ json: program.opts().json });
      console.log(chalk.green("✓ Risk audit complete"));
    } catch (err) {
      spinner.fail("Risk audit failed");
      console.error(chalk.red(err.message));
      process.exit(1);
    }
  });

program
  .command("dependabot")
  .description("Explain why Dependabot PRs may fail")
  .action(async () => {
    const spinner = ora("Analyzing potential Dependabot issues...").start();
    try {
      spinner.stop();
      await explainDependabot({ json: program.opts().json });
      console.log(chalk.green("✓ Analysis complete"));
    } catch (err) {
      spinner.fail("Analysis failed");
      console.error(chalk.red(err.message));
      process.exit(1);
    }
  });

program
  .command("fix")
  .description("Auto-fix issues (unused deps, lockfile sync)")
  .option("--dry-run", "Preview fixes without applying them")
  .action(async (cmd) => {
    const spinner = ora("Analyzing fixes...").start();
    try {
      spinner.stop();
      await autoFix({ json: program.opts().json, dryRun: cmd.dryRun });
      console.log(chalk.green("✓ Fix analysis complete"));
    } catch (err) {
      spinner.fail("Fix failed");
      console.error(chalk.red(err.message));
      process.exit(1);
    }
  });

// Only run CLI if not in test environment
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  program.parse(process.argv);

  if (!process.argv.slice(2).length) {
    program.help();
  }
}

// Export functions for testing
export {
  detectPackageManager,
  parseLockfile,
  scan,
  unused,
  updateSuggestions,
  riskAudit,
  explainDependabot,
  autoFix
};