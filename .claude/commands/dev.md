# Start Development Server

Start the Grep Build development server for testing changes.

## Command

Run this script which generates a unique name and starts the dev server:

```bash
./scripts/dev.sh
```

The script will:
1. Generate a unique dev instance name (e.g., `snappy-koala`)
2. Print it prominently to the terminal
3. Kill any existing process on port 9000
4. Start the dev server with the name passed as an environment variable

## Output

The script prints the instance name clearly:
```
========================================
  DEV INSTANCE: snappy-koala
========================================
```

**Report this name to the user** so they know which build to test.

## Notes

- The instance name appears in amber in the bottom-right of the app's status bar
- Each run of `./scripts/dev.sh` generates a new unique name
- Hot reload is enabled - most changes apply without restart
- For main process changes, restart the dev server

## CRITICAL: Always report the instance name

After running `./scripts/dev.sh`, always tell the user the instance name from the terminal output, e.g.:

> Dev build **snappy-koala** is now running.
