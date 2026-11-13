# Validation

Verified from the clean submission on **14 November 2026**, using Node.js **v22.22.0** and local PostgreSQL. The research workspace and supplied originals were preserved.

| Check                                   | Result                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Dependency audit                        | Zero known vulnerabilities in installed dependencies at verification time                                 |
| Clean locked dependency installation    | Passed                                                                                                    |
| Database setup                          | Previously verified in a fresh isolated database; this pass reused it and verified unchanged fingerprints |
| Strict TypeScript and type-aware ESLint | Passed, zero diagnostics                                                                                  |
| Formatting and browser bundle build     | Passed                                                                                                    |
| Unit tests                              | 179 passed, 6 opt-in database skips, 0 failures, 0 TODO                                                   |
| Actual PostgreSQL integration           | 6/6 passed                                                                                                |
| API and security boundaries             | 5/5 passed                                                                                                |
| Supplied inputs                         | 20 ordered outputs; ID/null and bounded confidence checked                                                |
| Behavior preservation                   | 1,205 cases: identical IDs, confidence and full candidate sets                                            |
| Scale                                   | 10,000 vehicles / 100,000 listings; disposable schema removed                                             |
| CI                                      | Updated Node/PostgreSQL workflow; remote execution of these changes awaits publication                    |

Seven new boundary tests cover malformed requests, response consistency, safe SQL-row/count parsing, invalid configuration, client error handling and cancellation-signal forwarding. The stronger compiler flags apply to application, browser, scripts and tests. No blanket non-null assertions, unsafe `any` suppression or type-check bypass was introduced to silence errors.

The behavior-preservation check covers **1,163 exposed development cases and 42 latest frozen cases** against saved matching outputs. It establishes refactoring parity, not new accuracy. The full historical corpus remains in the separate research workspace; the supplied cases, focused regression tests and latest 42 public-listing cases are included here. Original label disagreements and uncertain results were not removed to improve scores.

## Accuracy evidence

The latest frozen public-listing selection sample scored **39/42 selected IDs and complete sets (92.9%)**, with **one wrong selection and two false absences**. Labels were frozen before matching, but are provisional agent judgments on a convenience sample. This sample selected an implementation; it is not independent post-selection confirmation or a production estimate. Replaying it here reproduced the same result.

Sources, exact excerpts and expected sets are in [public-listings.json](../test-data/public-listings.json). Run `npm run evaluate` against the supplied catalogue to reproduce `results/evaluation.json`. Changed catalogue/count data can change results. Known failures concern manual override, packages with an omitted grade and an unsupported named grade. No interpretation changes followed that frozen test. **100% accuracy is not claimed.**

## Performance and integrity

The synthetic unique workload ran **500 requests**, with p95 **0.198 ms** and index construction **0.333 s**. This single-machine matcher/database measurement excludes HTTP overhead and does not certify production capacity or establish a speed improvement over earlier runs. Repeated/cache/concurrent workloads and machine metadata are in [benchmark-summary.json](benchmark-summary.json). No language-model calls occurred. CPU/database/engineering costs were not priced.

[validation-summary.json](validation-summary.json) records source hashes, original supplied hashes, database fingerprints and check totals. Listing counts are queried live for ties; catalogue/source changes require a new matcher or server restart. The local API exposes stale-snapshot status.
