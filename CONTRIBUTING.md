# Contributing and branching strategy

This repository uses a lightweight GitHub-flow strategy. `main` is the only long-lived branch and must remain deployable. All normal changes are made on short-lived branches and merged through pull requests.

## Protected branch

- `main` represents the current production-ready code.
- Do not commit or push directly to `main`.
- Do not force-push or rewrite `main` history.
- Vercel production deployment should follow merges to `main`.
- Database migrations are deployed separately and deliberately; merging a migration does not prove it was applied to Supabase.

Recommended GitHub rules for `main`:

- Require a pull request before merging.
- Require at least one approval.
- Require resolved review conversations.
- Require the repository test/build check when CI is configured.
- Require branches to be current before merging.
- Block force pushes and branch deletion.
- Prefer linear history and squash merging.
- Apply the rules to administrators too, except for documented emergency recovery.

## Branch names

Use lowercase kebab case:

```text
<type>/<issue-number>-<short-description>
```

The issue number is recommended when one exists and may otherwise be omitted.

| Type | Use | Example |
| --- | --- | --- |
| `feat` | New user-visible behavior | `feat/128-bulk-assignment` |
| `fix` | Defect correction | `fix/141-capacity-race` |
| `hotfix` | Urgent production correction | `hotfix/login-regression` |
| `refactor` | Internal restructuring without intended behavior change | `refactor/application-service` |
| `perf` | Performance improvement | `perf/application-pagination` |
| `docs` | Documentation only | `docs/branching-guide` |
| `test` | Test-only change | `test/bulk-assignment-rls` |
| `chore` | Maintenance or dependency work | `chore/update-supabase-cli` |
| `ci` | Build or automation configuration | `ci/pr-validation` |

Good names describe one outcome. Avoid personal names, generic names such as `updates`, and permanent developer branches.

For milestone work without an issue number, use a name such as:

```text
feat/v0-8-bulk-assignment
```

## Start a branch

Begin from the latest remote `main`:

```powershell
git switch main
git pull --ff-only origin main
git switch -c feat/128-bulk-assignment
```

If work is already uncommitted on `main`, create the branch before committing; the working-tree changes will follow you:

```powershell
git switch -c feat/v0-8-bulk-assignment
```

Do not mix unrelated fixes into the same branch or pull request.

## Commit messages

Use a Conventional Commit-style subject:

```text
<type>(optional-scope): imperative summary
```

Examples:

```text
feat(applications): add capacity-aware bulk assignment
fix(api): revalidate workload under row locks
docs: document pull request workflow
test(database): cover assignment batch RLS
```

Keep commits reviewable and never commit `.env` files, access tokens, database passwords, service-role keys, build output, or unrelated generated files.

## Validate before pushing

Run the full local check:

```powershell
npm run check
```

When a Supabase migration changes and a local Supabase stack is available, also run:

```powershell
npm run test:db
```

When Docker/Supabase is unavailable, state that clearly in the pull request. A linked dry run does not count as a successful migration or database test.

## Push the branch

Push the current branch without typing its name twice:

```powershell
git push -u origin HEAD
```

The `-u` option establishes upstream tracking. Later pushes need only:

```powershell
git push
```

If authentication returns HTTP 403, verify that the signed-in GitHub account has write access to the repository. Git `user.name` and `user.email` identify commits but do not grant repository access.

## Open a pull request

Open a PR into `main` in GitHub, or use GitHub CLI:

```powershell
gh pr create --base main --head feat/128-bulk-assignment --fill
```

The PR title should follow the commit convention. The description must explain:

- The problem and resulting behavior.
- Important architecture or security decisions.
- Migration, RLS, Storage, API, extension, and deployment impact.
- Commands actually run and their results.
- Manual, browser, live Supabase, concurrency, or recovery tests not performed.
- Screenshots for meaningful UI changes.
- Follow-up work or known limitations.

Use a draft PR while work or verification remains incomplete. A PR is ready for review only when its description and checklist are accurate.

## Update a pull request

Prefer rebasing a private feature branch onto the latest `main`:

```powershell
git fetch origin
git rebase origin/main
git push --force-with-lease
```

Use `--force-with-lease`, never plain `--force`, and only rewrite a branch that no one else is using. For a shared branch, merge `origin/main` instead and push normally.

Resolve review feedback with additional commits. GitHub's squash merge will combine them into one clean `main` commit.

## Merge and cleanup

Merge when:

- Required reviews are approved.
- Required automated checks pass.
- Review conversations are resolved.
- The branch contains no secrets or unrelated changes.
- Database and deployment limitations are documented.

Use **Squash and merge**, give the final commit a Conventional Commit title, and delete the remote branch. Then clean up locally:

```powershell
git switch main
git pull --ff-only origin main
git branch -d feat/128-bulk-assignment
git fetch --prune
```

## Hotfixes

Hotfixes still use a branch and pull request:

```powershell
git switch main
git pull --ff-only origin main
git switch -c hotfix/login-regression
```

Keep the change minimal, run the relevant regression tests plus `npm run check`, obtain expedited review, and document any skipped test. Do not establish a permanent `hotfix` branch.

## Database migration rules

- Never edit a migration that has already been applied to a shared environment.
- Correct deployed schema with a new forward migration.
- Use the repository timestamp-and-milestone filename convention.
- Inspect existing tables, functions, grants, indexes, and policy names first.
- Include RLS, grants/revokes, constraints, indexes, and pgTAP/static tests in the same PR.
- Report live deployment separately from code review; do not say a migration passed when only a dry run occurred.

## Release tags

After an approved release merge, a maintainer may create an annotated semantic-version tag from `main`:

```powershell
git switch main
git pull --ff-only origin main
git tag -a v0.8.0 -m "Release v0.8.0"
git push origin v0.8.0
```

Do not tag feature branches or move an existing release tag.
