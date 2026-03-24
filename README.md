# tigers

crawl tigers website, get live information and create tasks to todoist.

## Local Development

To run locally:

```bash
# Default port 8080
deno task dev

# Or specify a custom port
PORT=3000 deno task dev
```

The application will start an HTTP server and the cron job will be scheduled (note: cron only works on Deno Deploy).
