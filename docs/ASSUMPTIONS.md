# Assumptions and design decisions

- The catalogue is authoritative. Missing descriptions do not imply missing vehicles; explicit unsupported identities or incompatible attributes can justify `null`.
- A complete basic grade is preferred over a longer named edition when the basic grade is explicitly asserted. Partial grade evidence retains compatible alternatives. These policies are imperfect for seller shorthand; conflicting historical annotations were not silently relabelled.
- Explicit uncorrected field conflicts are unresolved. Corrections and negation are scoped to their subjects. Donor, equipment and replacement facts are not target facts when their role can be established.
- Fuel compounds and numeric grade abbreviations use bounded syntax and catalogue evidence. No year/cylinder-based drivetrain or fuel inference is made. Narrow model-code associations have source comments and do not infer unsupported fields.
- Every equally supported candidate survives retrieval; no arbitrary top-K cutoff precedes the popularity tie-break. Counts come from the live listing table. Equal counts use ascending string ID.
- IDs remain strings. Confidence is bounded to 0–10; incomplete/ambiguous matches are less certain. Low-confidence nulls represent uncertainty, not proof of absence. The README’s example scores are illustrative; this heuristic need not reproduce every example number.
- The catalogue is loaded once per matcher instance. Recreate the matcher after catalogue changes. Exact-input analysis is bounded by an LRU cache; concurrent duplicate requests share work. Listing counts are queried again for ties.
- Inputs over 512 interpreted tokens require manual review. The optional local API additionally caps input characters, request bytes, active requests, connections and timeouts. Database failures propagate as operational errors.
- `data.sql` creates `listing.it` but inserts `listing.id`. Setup changes only that declaration in memory, inside a transaction, and preserves all supplied bytes and rows. The source README says `input.txt` once; the supplied file is `inputs.txt`.

## Alternatives considered

Token similarity alone confuses donor/equipment words with vehicle identity. Classical logistic and shallow boosted-tree experiments on exposed development features did not improve the last separately frozen comparison in which they were tested. The selected implementation therefore uses explicit evidence composition and catalogue constraints. Those research implementations and extensive iteration logs are outside this submission; no learned artifacts are required to run it.

The interpretation pipeline remains the main limitation. A scorer cannot recover facts discarded before candidate comparison. More data with human-adjudicated span roles and a representative untouched evaluation would be needed to substantiate broader accuracy or calibrated confidence.
