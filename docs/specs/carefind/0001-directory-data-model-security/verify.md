# Verify: directory data model plus security · spec 0001 · updated 25 Sep 2026
_Steps derived from spec 0001 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._
## UI / manual
- [ ] Open Business Directory as admin with empty table → empty state shows → AC-1
- [ ] Add Business with name only → category plus state required errors → AC-1, AC-3
- [ ] Add with name plus category plus state → row appears unverified → AC-1
- [ ] Open details → Verify → badge flips plus history row shows verifier plus time → AC-1
- [ ] Hide via delete → row leaves the list, still stored with active false → AC-1
- [ ] Download template → 17 headers plus example row → AC-3
- [ ] Upload 1001 row file → over cap message asking to split → AC-3
- [ ] Import the same business twice → possible duplicate flagged with review, skip, import new → AC-4
- [ ] Discovery search with no data → No verified result found, never invented → AC-5, AC-8
- [ ] Add two same name businesses in different states → both kept with different slugs → AC-4
## Commands
- [ ] `npx vitest run` in `apps/carefind` → 1168 pass → AC-10
- [ ] `npm run build` in `apps/carefind` → clean → AC-10
- [ ] Anon probe select on `business_directory` as anon → 0 rows → AC-8
- [ ] Grant check on both RPCs → anon false, authenticated true → AC-8, AC-9
## Acceptance-criteria coverage
- AC-1 covered by steps 1 to 5 · AC-2 unchanged this run, wired via existing categories tab · AC-3 covered by steps 2, 6, 7 · AC-4 covered by steps 8, 10 · AC-5 covered by step 9 · AC-6 code wired, needs seeded data for full click through · AC-7 code wired, needs seeded data · AC-8 covered by steps 4, 9 plus commands 3, 4 · AC-9 live probed with temp row, distance 0 plus stats breakdown shown · AC-10 covered by commands 1, 2
