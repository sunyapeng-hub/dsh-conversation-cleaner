# rc10 independent review and repair closure

Six RC9 audit defects are closed in runtime code and red/green regressions. No new development backup or checksum workflow was introduced.

- Provenance continuity is checked before native read/write/edit; independent replacement or external edit loses ownership. Actual native edit schema was verified against installed first-party sources.
- Terminal journals use a minimal whitelist; explicit legacy cleanup never touches restored live files. Active recovery retains necessary payload.
- A/B0/C0 does not bind unrelated event revisions; actual resources still require complete corpus references and cold leases.
- Preview refresh and submit expiry guards preserve the single action confirmation.
- Restore preflight precedes moves; failure states remain retryable; ungrouped fallback requires an explicit user action.
- Permanent intent can resume precise remaining staged files, including interrupted hardlink groups; replaced targets and external aliases refuse.
- Direct recovery is available after deletion, in session menus and in this plugin's own details even with no session rows.

An independent read-only reviewer ran 53 targeted tests and three extra hardlink adversarial cases with no blockers. Final native-edit and plugin-details changes were independently checked against real host contracts; 23 targeted tests passed. Final full suite: 129/130 passed, 1 privilege skip, zero failures. Both real hosts have fresh A/B/C restart/restore and 11 native repair checks; real NEXT mocked-API UI checks are separate. See acceptance-report.json for evidence provenance and remaining limits.
