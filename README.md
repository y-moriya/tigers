# tigers

Crawl Hanshin Tigers website, get live broadcast schedule, and sync tasks to Todoist.

## Architecture

- Runtime: Cloudflare Workers
- Package Manager: pnpm
- Testing: Vitest
- Domain: `https://tigers.gunjobiyori.com`
- Cron Trigger: Every day at 19:00 UTC (`0 19 * * *`)

## Local Development

```bash
# Run local dev server with Wrangler
pnpm dev

# Run unit tests
pnpm test

# Type check
pnpm typecheck
```

## Deployment

Deploy to Cloudflare Workers with custom domain `tigers.gunjobiyori.com`:

```bash
pnpm deploy
```

## Secrets Configuration

Set the required secrets for production on Cloudflare Workers:

```bash
pnpm wrangler secret put TODOIST_API_TOKEN
pnpm wrangler secret put TODOIST_TIGERS_PROJECT_ID
pnpm wrangler secret put AXIOM_TOKEN
```

