# Compatibility evidence — 2026-11-04, 1.0.0-rc.11

Windows: NEXT 2.0.20-next/Core 0.2.1-rc.3, Cordis 4.0.5, original Electron 44.7.0; official DSH Web Core rc.3 in real Microsoft Edge. Both isolated profiles install the same candidate. Runtime and published package are compared directly without checksums. Exact private API versions remain required.

Fresh rc11: A/B/C normal deletion, host restart and restoration in both hosts. Historical incomplete resource proof in actual native UI: B delete and direct restore, C permanent delete, preserved workspace-file and attachment byte equality, foreign live owner untouched, selected original startup owner closes only on commit, no pending operations afterward. Historical incompleteness is introduced only in isolated fixture records. No real user data was deleted.

Automatic suite: 136/137 pass, 1 Windows symlink-privilege skip, zero failures. Covers missing/corrupt proof, unsupported calls, foreign corrupt headers/events, interrupted recovery, no scope broadening, normal resource deletion and unchanged safety guards.

Earlier rc10 native recovery/pin/archive/legacy residue and mocked-API timer/footer reports retain their original version, as do older shared-host/running-agent/locale/startup guard tests. They are enumerated in acceptance-report.json.

Resource uncertainty now yields a selected-log-only plan with an explicit preserved-resource warning. It never guesses ownership from shell output or deletes resources merely because their references are unknown. Its policy/reasons bind into preview metadata. Fully proven resource cleanup still uses global references, native root/session leases, hardlink-group checks and upload receipts. Target-log corruption and live/pending ownership remain refusals.

NEXT uses original runtime and unmodified extracted source in an unpackaged isolated deployment, normal desktop profile and safeMode=false. Test roots are only .test-data/next-normal and .test-data/web-v2. Office/packaged launcher, macOS/Linux and other host versions are not claimed. Shared roots require compatible participants; external writers and unknown stores remain outside coordination. Formal installation was not altered by this repair.
