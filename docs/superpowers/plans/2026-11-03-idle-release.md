# Idle session release

Goal: after the existing Delete click, close the selected idle local conversation through its original AgentHandle, then acquire its native lease and retain all preview/commit checks.

The installed rc3 controller has cancel but no close API. Capture handles returned by its agent factory, preserving the caller context; never detach registries or remove session.lock directly. Gate this small compatibility bridge to the verified host version. Existing handles from before plugin startup require a normal restart. Running, maintenance, queued input, staged uploads, foreign owners and other conversations remain protected. Preview stays read only.

- [x] Add failing bridge and adapter tests for exact ownership, no preview mutation, pending work, release failure and teardown.
- [x] Implement the bridge and commit-time release without weakening stale-plan checks; clarify blocker text.
- [x] Verify real idle current-session delete/restore, running refusal and pending work in isolated NEXT; run existing host/mode checks.
- [ ] Update release documentation/evidence, build rc.7 and publish the authorized public repository.
