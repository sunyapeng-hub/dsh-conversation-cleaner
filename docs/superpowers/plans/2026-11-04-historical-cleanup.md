# Historical cleanup implementation plan

Goal: historical/unsupported tool ownership no longer blocks deleting the selected conversation. Keep every resource whose deletion cannot be proved and make that retained scope visible before the existing single confirmation.

User has requested direct execution. No new backup/checksum, no real user deletion, no additional approval dialogs.

Design: keep strict resource inspection for proven cleanup. On resource-only provenance/reference uncertainty, build the ordinary selected-conversation plan with an explicit `preserve_unverified` resource policy and warning. Its original requested mode stays visible. The policy and uncertainty reasons bind into metadata so commit cannot silently broaden scope. Selected-session integrity, ownership, registry, transaction and compatibility guards remain. No shell output guessing or retroactive fabricated ownership.

- [x] Add failing adapter regressions: missing target proof, unsupported tool, incomplete foreign proof, corrupted foreign log and old reference metadata preserve resources and permit selected-only cleanup. Commit and permanent deletion retain user files/attachments; no foreign leases are acquired. Fully proven cleanup remains unchanged; busy and stale-registry guards remain.
- [x] Implement explicit retained-resource plans in `src/adapters/dsh.js`; add one visible warning and clear unknown statistics in `src/client/index.js`. Add UI regressions proving Delete enabled and warning visible without opening details.
- [ ] Build rc11, run full automated suite and fresh isolated Web/NEXT historical-session UI deletion/restoration/permanent cases. Reuse existing real A/B/C acceptance where meaningful with explicit version scope.
- [ ] Update documentation and evidence, review, package and deliver to the previously authorized public repository. Verify published package and both isolated runtimes by raw-byte comparison; do not modify or delete formal user conversations.

