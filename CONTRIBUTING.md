# Contributing to Nairobi Transit

Thanks for your interest in contributing. This project is open to anyone who wants to help improve cashless matatu payments in Nairobi.

## Getting started

1. Fork the repository and clone your fork
2. Set up local development (see the README for prerequisites)
3. Create a branch for your work: `git checkout -b my-change`

### Local environment

```bash
# Start Postgres and Redis
docker compose up -d postgres redis

# Backend (Rust)
cp server/.env.example server/.env   # fill in credentials
cd server && cargo run

# Frontend (Next.js)
cd frontend && npm install && npm run dev
```

The backend runs on port 8080, the frontend on port 3000. Migrations run automatically when the server starts.

## What to work on

- Check the [Issues](https://github.com/lawravasco2207/nairobi-transit/issues) tab for open bugs and feature requests
- Small fixes (typos, docs, error messages) are always welcome
- If you want to tackle something larger, open an issue first so we can discuss the approach

### Areas that need help

- **GIS data refresh.** The stop and route data is from 2019 and needs updating. If you have access to newer Digital Matatus or GTFS data for Nairobi, that would be hugely valuable.
- **Testing.** The project currently has no automated test suite. Unit tests for the Rust handlers and integration tests for payment flows are a priority.
- **Accessibility.** The frontend could use an accessibility audit, especially the USSD simulator and conductor dashboard.
- **Localization.** Swahili translations for the passenger-facing pages.

## Submitting changes

1. Make your changes on a feature branch
2. Test locally: make sure `cargo build` succeeds and the frontend compiles with `npm run build`
3. Keep commits focused. One logical change per commit.
4. Open a pull request against `main` with a clear description of what you changed and why

### Code style

- **Rust:** Follow standard `rustfmt` formatting. Run `cargo fmt` before committing.
- **TypeScript:** Follow the existing ESLint config. Run `npx eslint .` in the frontend directory.
- **SQL migrations:** Number them sequentially (e.g. `008_your_migration.sql`). Each migration should be safe to re-run or wrapped in a transaction.

### Commit messages

Use a short summary line, optionally followed by a blank line and more detail:

```
fix: handle USSD timeout gracefully when Redis is slow

The USSD handler was returning a 500 when Redis took longer than 100ms.
Now it falls back to a "please try again" response instead.
```

Prefixes like `fix:`, `feat:`, `docs:`, `refactor:` are helpful but not required.

## Reporting bugs

Open an issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce (if possible)
- Browser/OS/device info for frontend issues

## Security issues

If you find a security vulnerability, please **do not** open a public issue. Email the maintainer directly so it can be patched before disclosure.

## Code of Conduct

All contributors are expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Be respectful, be constructive, and assume good faith.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
