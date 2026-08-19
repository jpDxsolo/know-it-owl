export async function endRound(_args: Record<string, unknown>): Promise<unknown> {
  // TODO: verify gmToken, require all responses graded, sum points per team, apply x2
  // for teams that doubled this round (set doubleUsedRound), update team scores,
  // set round status REVEALED. Fan out ROUND_REVEALED via GameUpdate.
  throw new Error("Not implemented: endRound");
}
