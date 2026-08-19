/**
 * Randomly split players into `teamCount` teams whose sizes differ by at most 1.
 *
 * Fisher–Yates shuffle, then deal round-robin. E.g. 20 players / 3 teams -> 7, 7, 6.
 *
 * @param random injectable RNG returning [0, 1), defaults to Math.random
 */
export function randomizeTeams(
  playerIds: readonly string[],
  teamCount: number,
  random: () => number = Math.random,
): string[][] {
  if (!Number.isInteger(teamCount) || teamCount < 1) {
    throw new Error(`teamCount must be a positive integer, got ${teamCount}`);
  }
  if (teamCount > playerIds.length) {
    throw new Error(
      `teamCount (${teamCount}) cannot exceed player count (${playerIds.length})`,
    );
  }

  const shuffled = [...playerIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const teams: string[][] = Array.from({ length: teamCount }, () => []);
  shuffled.forEach((playerId, i) => {
    teams[i % teamCount].push(playerId);
  });
  return teams;
}
