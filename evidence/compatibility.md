# Compatibility evidence — 2026-11-03

Verified: Windows, official DSH Web Core 0.2.1-rc.3; DSH NEXT 2.0.20-next with Core rc.3, Electron 44.7.0 / Node 24.21.0. CLI/tests use Node 22.19.0. Installed artifact source commit is not published in its local metadata and remains UNKNOWN.

The same 1.0.0-rc.7 tgz was installed in both profiles. NEXT used its native installer; desktop profile CLI edits were rejected and not bypassed. The isolated desktop app uses original installed runtime binaries and unmodified extracted source, normal desktop profile and safeMode=false; it is an unpackaged test deployment. Its Office integration and native packaged directory-transition launcher are outside this acceptance.

Data roots: F:/Projects/PLUS Project/.test-data/web-v2 and .test-data/next-normal, confirmed by live fixture responses. Formal user conversations were not altered.

Contracts: persistence locate/open/acquireWriteLease, workspace attach/detach/pin/archive, authenticated connection.requestRejection, native sidebar menu and Modal, api-session/removed and added. rc3 coordination uses a version-pinned Node request listener/matched route bridge and read-only FileUploads staged receipt WeakMap bridge. Agent factory handles are captured by a version-pinned rc3 compatibility wrapper; Delete closes only selected idle handles. No host source file is patched. Unknown versions refuse deep cleanup.

Root coordination covers participating compatible hosts, guards mutation HTTP handlers through completion even after disconnect, and retains native root/session leases. Real two-host holding/race tests pass. Cached workspace state is compared with the persisted JSON unit before mutations; stale hosts must restart. Arbitrary external writers, unmodified hosts and unknown plugin stores are not claimed coordinated.

Attachment planning covers full canonical survivor logs, proven paths, staged upload receipts, recoverable operation references, known JSON stores and mapped DeepSeek upload/image cache records. It checks complete local alias/canonical hardlink groups. Unknown image cache variants stay. Physical logs omitted by rc3 list() because of corrupt headers now block deep cleanup.

No attachment content digest is recomputed. Identity and preview/commit raw bytes establish stability after planning, not that a store modified before preview still matches its original content. No macOS/Linux or other host-version result is claimed. See acceptance-report.json for per-case scope.
