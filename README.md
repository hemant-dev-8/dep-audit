# dep-audit

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-blue.svg)](https://nodejs.org/)
[![npm](https://img.shields.io/badge/npm-%3E%3D7-green.svg)](https://www.npmjs.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An advanced CLI tool for auditing npm dependencies. Goes beyond `npm audit` by detecting unused dependencies, assessing health risks, suggesting safe updates, and explaining Dependabot failures. Perfect for developers and teams maintaining clean, secure package.json files.

## 🚀 Features

- **Scan & Analyze**: Read `package.json` and lockfiles (`package-lock.json` or `yarn.lock`) for a full dependency overview.
- **Unused Detection**: Identify and report unused dependencies using `depcheck`.
- **Risk Assessment**: Assign health scores (0-10) based on last update, maintainers, downloads, and known CVEs.
- **Smart Updates**: Suggest updates with semver checks for breaking changes; optional `--safe` mode skips majors.
- **Dependabot Explainer**: Diagnose common PR failures like version mismatches or peer conflicts without installing.
- **Pretty Output**: Spinners, colors, and structured reports for better UX.
- **Dry-Run Mode**: Preview fixes before applying (default for trust-building).

Built with Node.js, modular design, and minimal dependencies. Open-source and extensible!

## 📦 Installation

### Global Install (Recommended)
```bash
npm install -g dep-audit
```

### Local/Development
```bash
git clone https://github.com/yourusername/dep-audit.git
cd dep-audit
npm install
npm link  # For local testing
```

> **Requirements**: Node.js ≥18, npm ≥7. Run in a project with `package.json`.

## 💡 Usage

Navigate to your project root and run commands. All commands work offline where possible, but some (risk/update) fetch from npm registry.

```bash
dep-audit scan          # Basic scan of deps and lockfile
dep-audit unused        # List unused dependencies
dep-audit risk          # Health scores for all deps
dep-audit update        # Update suggestions
dep-audit update --safe # Only non-breaking updates
dep-audit dependabot explain  # Explain potential Dependabot issues
dep-audit fix --dry-run # Preview auto-fixes (unused removal, lockfile sync)
```

### Example Outputs

#### `dep-audit risk`
```
express → Healthy ✅ (Score: 9/10)
  Reasons: low downloads
lodash → Risky ❌ (Score: 2/10)
  Reasons: last update >2 years, known CVEs, few maintainers
```

#### `dep-audit update`
```
✅ lodash: 4.17.21 → 4.17.21 (up-to-date)
⚠️ express: 4.18.0 → 5.0.0 (Breaking: major version bump – review changelog)
```

#### `dep-audit dependabot explain`
```
Dependabot failed because:
- react required ^18 in package.json, but locked at 17.0.2 in package-lock.json

Fix:
npm install react@^18
```

## 🛠️ How It Works

- **Core Libs**: Commander (CLI), depcheck (unused), semver (versioning), chalk/ora (UX).
- **Data Sources**: Parses files directly; uses `npm view` and `npm audit` for metadata/CVEs.
- **Yarn Support**: Basic lockfile parsing (extend via `@yarnpkg/lockfile`).
- **No Installs**: Most commands read-only; fixes suggest commands to run manually.

For full logic, check `/src/` files (e.g., `risk.js` for scoring rules).

## 🤝 Contributing

Love the idea? Fork it, add features (e.g., yarn full support, GitHub integration), and PR!

1. Fork & clone.
2. `npm install`.
3. Add tests (use Jest – not included yet).
4. `npm test` (TBD).
5. Commit & push.

Issues? Open one – feedback on scoring logic or UX welcome.

## 📄 License

MIT License – see [LICENSE](LICENSE) (create one if missing).

## 🙏 Acknowledgments

Inspired by npm audit limitations and Dependabot pains. Built with ❤️ for the dev community.

---

*Version 1.0.0 | Built on December 15, 2025*  
[GitHub Repo](https://github.com/hemant-dev-8/dep-audit) | [npm](https://www.npmjs.com/package/dep-audit)