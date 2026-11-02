# DSH Conversation Cleaner Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation. User requests direct work without intermediate confirmation.

**Goal:** Build one Cordis bundle with a three-mode, confirmed deletion dialog for DSH and NEXT.
**Architecture:** Public client slots and authenticated Host routes; one versioned persistence adapter, read-only plans and coordinated quarantine transactions. Reuse actual installed/upstream interfaces only.
**Tech Stack:** Node.js ESM, React supplied by the host, node:test, Chromium E2E.
**Spec:** specification/DSH_Conversation_Cleaner_V1_Rebuilt_20261102/01_REQUIREMENTS.md through 05_TEST_AND_ACCEPTANCE.md.

## Global Constraints
- One original ZIP backup only; no checksums or hash manifests (direct user override).
- Never modify/delete production user sessions in testing.
- No DOM/fiber session inference, no host-core modifications, no fabricated compatibility.
- Default A; B/C require provable ownership and references. Missing evidence blocks the requested mode before writes.

## Review Focus
- Live and externally leased sessions: reject before mutation.
- Stale plans and changed filesystem identities: invalidate.
- Shared references and old files: retain.
- Registry failure/crash: recover without overwriting occupied paths.
- Auth, CSRF, malformed IDs: reject at route boundary.

## Tasks
1. [ ] Research exact core/client contracts, versions and licenses. Write evidence/compatibility.md.
2. [ ] Write failing deletion tests for preview, A/B/C, stale/replay/active protection and rollback; implement src/host domain and adapters; run node:test.
3. [ ] Write failing route/client behavior tests; implement Host mounting and Client menu/dialog with bilingual strings, explicit confirmation and theme support.
4. [ ] Build bundle and run isolated real-host installation, browser flows, durable deletion/restart and recovery tests wherever host availability allows.
5. [ ] Review implementation; repair important findings; generate one installable tgz, install/uninstall/restore docs and truthful evidence report.
