# AI assistance

This is an AI-assisted implementation. The user requested local matching without runtime language-model calls, evaluation on additional real listings, a clean submission, and explicit disclosure of generated decisions and assets.

Astra/Codex assisted with interpretation and SQL code, tests, benchmark tooling, the optional web page, documentation, requirement review, data-source research and evaluation. The README, algorithm diagram, this disclosure, assumptions, audit and validation documents are AI-generated text assets. The user directed scope and priorities; the technical implementation and detailed design choices should not be represented as unaided personal work.

During development, authored examples and publicly sourced excerpts were used to compare approaches. Source excerpts and provisional labels were frozen before the latest comparison. Once scored, those inputs became exposed data. Incorrect results and policy disagreements were retained; no universal accuracy claim is justified. Earlier classical-model experiments were considered but are not part of the submitted runtime.

For submission, the selected matcher was specialized into one implementation and the UI/docs were simplified. Behavior preservation was checked against development and the latest frozen cases, including selected IDs, confidence and full candidate sets. This packaging work is not a new unseen evaluation. A further engineering pass added stricter TypeScript, typed lint/formatting, shared runtime contracts, validated SQL/configuration boundaries and a typed browser client. The same 1,205-case parity check was repeated; these changes do not imply an accuracy gain.

Original challenge files are preserved under `supplied/`. No private employer materials, credentials, language-model APIs or paid inference dependencies are included. General engineering principles informed the audit; their private instructional sources are not redistributed. See `docs/ASSUMPTIONS.md` for generated design decisions and `docs/VALIDATION.md` for measured limits.
