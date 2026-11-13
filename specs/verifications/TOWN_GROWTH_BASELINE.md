# Town growth baseline

**type:** verification
**context:** domain

Before gameplay changes:

- `npm run verify`: PASS, 23 files / 158 tests, typecheck, lint and production build.
- `npm run test:e2e`: PASS, 7 browser tests.
- Source-only baseline snapshot outside workspace: `D:/tmp-tidehaven-baseline/`.
- Test temp directory: `D:/tmp-tidehaven-tests/` (C: has less than the app's free-space floor).
- Browser path: `D:/Projects/Tidehaven/.playwright`.

Commands:

```bash
TMP='D:\tmp-tidehaven-tests' TEMP='D:\tmp-tidehaven-tests' npm run verify
PLAYWRIGHT_BROWSERS_PATH='D:\Projects\Tidehaven\.playwright' \
  TMP='D:\tmp-tidehaven-tests' TEMP='D:\tmp-tidehaven-tests' npm run test:e2e
```

No saved town, credentials or live-model calls were used. The project is not a Git repository, so
branch/worktree/commit gates cannot run; do not initialize a repository or make automatic commits.
