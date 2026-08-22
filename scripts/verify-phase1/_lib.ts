/**
 * Wiederverwendet die Phase-0-Testinfrastruktur statt eine neue aufzubauen —
 * siehe Plan (`/Users/mathias/.claude/plans/teil-b-die-staged-codd.md`,
 * Abschnitt "Verifikation"): "Jeder Phase-1-Schritt legt analog
 * `scripts/verify-phase1/NN-*.ts` an und erweitert einen gemeinsamen Runner
 * — statt einer neuen Test-Infrastruktur." `record()`/`printFinalReport()`/
 * `rawPool()`/... sind bereits generisch (nicht Phase-0-spezifisch).
 */
export * from "../verify-foundation/_lib";
