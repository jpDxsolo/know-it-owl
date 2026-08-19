export async function submitAnswers(_args: Record<string, unknown>): Promise<unknown> {
  // TODO: resolve player's team, require round ACTIVE and no prior submission,
  // validate answer counts (1 for TEXT, 10 for PICTURE_10), honor double flag
  // (reject if doubleUsedRound set), put RESP#<round>#<qn>#TEAM#<teamId> items.
  throw new Error("Not implemented: submitAnswers");
}
