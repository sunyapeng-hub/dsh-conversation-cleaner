# Independent review and fixes

Read-only reviewer findings were addressed in runtime code and regression tests. No reviewer edits or additional development backups were made.

- Scan survivors across cwd; verify durable call IDs; treat unsupported tools/PTC as unknown; canonicalize read paths.
- Serialize participating hosts through native root leases; keep every required cold-session lease; protect unsent upload receipts for exempt blank drafts.
- Await real matched HTTP route completion, including early response/abort; restore hooks without an HMR unload/request waiting cycle. Native rc.7 uninstall/reinstall passed.
- Include attachment alias/canonical paths and provenance references; require a complete hardlink group and preserve external aliases.
- Protect dependencies recorded by recoverable operations; old transactions missing reference metadata block deep cleanup.
- Recover pre-purge permanent intent; refuse missing or changed files and occupied destinations. Validate every unit identity before and after recovery; refresh restored output identity.
- Use owner PID/offline stale-lock handling, tested with real process exit. Use same-volume side quarantine for cross-volume output, tested on actual C:/F: volumes.
- Compare cached/persisted registry before writes. Detect physical logs omitted from host listing; a real corrupt compressed survivor test now returns 422.

Validation: six real host/mode gates plus restart/restore, actual running-agent refusal, actual staged receipts, two-real-host race, actual permanent confirmation and HTTP rejection; 81/82 automatic tests passed, 1 privilege skip. Limits and unrun UI/index combinations remain explicit in acceptance-report.json.

rc.7 read-only review confirmed original caller/handle preservation, exact selected targets, pending-work gates and HMR hook restoration. Failed commit after idle disposal republishes only existing rows. Actual NEXT idle A/B/C delete/restore and queued/maintenance/upload/stale-plan checks passed.
