# rc11 repair review

The historical-session regression first failed, then passed after a retained-resource plan was added. No new development backup or checksum process was introduced.

An independent read-only review found two related omissions: malformed provenance could break a log-only restore, and listed foreign corrupt-event logs bypassed the resource uncertainty path. Both received red/green regressions and fixes. The reviewer confirmed the final changes with two independent passing regressions and found no other blocking issue with locking or scope metadata.

Pure log restoration now skips provenance refresh entirely. Only foreign SessionPersistenceCorruptionError and SessionFormatUnsupportedError are converted to resource uncertainty; selected corruption, lock and unsafe-path failures are not swallowed. Unknown resources remain at their original paths. Preview metadata prevents retained scope from expanding at commit.

Final full automatic suite: 136/137 passed, 1 privilege skip, zero failures. Real NEXT/Web historical UI ordinary/restore/permanent cases and normal A/B/C restart/restore are fresh rc11 evidence. Other previous matrices keep their original version and time. See acceptance-report.json for exact scope.
