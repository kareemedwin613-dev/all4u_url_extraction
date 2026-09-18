# Background matching and tailoring batches

Run the usual dashboard command from the updated repository. Commands containing
`--batch-ticket` now launch a hidden, detached supervisor and return to the prompt.
Closing that terminal no longer stops the batch. No production process is started
just by installing this change; run your batch command to use it.

The supervisor restarts unexpectedly exited workers with the **same ticket** using
5/10/20/40/60-second delays (five consecutive restarts maximum). A successful item
resets this consecutive-failure budget. Server-side completed results, leases,
duplicate checks and per-job retry limits remain authoritative. It does not create
new tickets, silently change models or reset failed jobs indefinitely.

After a crash, outstanding jobs may need their existing leases to expire before
they can be reclaimed (matching currently five minutes; tailoring twenty minutes).
Tailoring now polls a RUNNING/PENDING batch instead of exiting when it has no local
jobs but the previous worker still holds leases. Other claimable jobs can continue.

## Visibility and control

The launch message prints a run ID and a log path. From the repository root:

```text
npm run workers:status
npm run workers:logs -- <run-id>
npm run workers:stop -- <run-id>
```

Status distinguishes running, retrying, completed, completed with failures,
stopped, interrupted and action required. Logs show the last 100 saved events.
They live in ignored `artifacts/worker-runs/<run-id>/events.jsonl`; logs rotate at
8 MiB with one previous file retained. Status is refreshed locally every five
seconds. These local diagnostics do not add dashboard polling or database writes.

Logs allow only stage/status/code/ID/timing/process metadata. Raw prompts, resume/JD
contents, stderr, command arguments and tickets are not persisted. Tickets pass to
the supervisor through stdin, then to workers through their environment. Restart
state is in memory; the on-disk run ID uses a ticket fingerprint, not the ticket.

Repeated starts with the same ticket and API origin attach to the existing local
run instead of adding a worker. Use the stop command, not Ctrl+C in the now-finished
launcher. Stopping locally preserves saved results and lets outstanding leases
expire; dashboard cancellation remains a separate action.

## Limits

- Keep the computer powered on and awake. This is not a Windows service and does
  not automatically restart after reboot, logout, or the supervisor itself being killed.
- Existing ticket lifetimes remain unchanged (matching eight hours, tailoring
  twelve hours after claim). Expired/revoked tickets, invalid configuration or
  authentication errors require attention; these are not endlessly retried.
- Final failed jobs remain failed/reviewable. Completed-with-failures is not
  reported as success. Job-level validation failures still follow existing rules.
- Single-job tickets, fixture mode and `--once` retain foreground behavior. Add
  `--foreground` to a batch command to use the old attached-terminal workflow.
- The automatic comparison child started after creating a tailored PDF still runs
  within the tailoring worker; this change does not introduce unlimited parallel
  comparison workers or a new comparison queue.

No new API deployment or database migration is required for this runner change.
Deploy the dashboard copy update separately. Older local checkouts still use the
foreground behavior, so update the repository on every machine running commands.
