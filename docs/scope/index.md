# Scope Index: CareFind Hub Business Discovery Initiative

You are planning a shared directory plus discovery plus field reporting system across two apps. This index points you to each workspace scope.

**Build approach:** Tracer Bullet (vertical slices, each feature built end to end through every layer, working).
**Workflow:** GA (after develop you run check verify then test then fresh review then document).

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit. You decide when a feature is done._

## At a glance

| Workspace | Scope file | Rollup |
|---|---|---|
| carefind | [carefind scope](carefind/scope.md) | 1 existing, 2 in progress, 8 planned |
| carehub | [carehub scope](carehub/scope.md) | 1 existing, 5 planned |
| _root | [reliable email](_root/0001-reliable-email-system.md) | 1 in progress, separate initiative |

## How to use this
1. You may start with carefind directory Slice 1 to get trusted data first.
2. You may then run discovery Slice 2 once data exists.
3. You may then link field work in carehub Slice 3.
4. You may leave Slice 4 territory insight until reporting is stable.

Heads up: directory security plus duplicate rules plus safe labels are the load bearing decisions. You may want specs for those before you build.
