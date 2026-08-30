import { randomizeTeams as splitIntoTeams } from "@know-it-owl/core";
import type { Player, Team } from "@know-it-owl/core";
import { requiredInt, requiredString } from "../lib/args.js";
import { getItem, queryPrefix, tableName, transactWrite } from "../lib/db.js";
import { ConflictError, NotFoundError, ValidationError } from "../lib/errors.js";
import { assertGm } from "../lib/gmAuth.js";
import { newTeamId } from "../lib/ids.js";
import * as keys from "../lib/keys.js";
import { toGame, toPlayer, type TeamItem } from "../lib/mappers.js";
import { assembleGame, gameUpdate, type GameUpdate } from "../lib/views.js";

/**
 * DynamoDB rejects a transaction of more than 100 items. One re-randomize costs
 * a delete per existing team, a put per new team, an update per player and one
 * update for the game — so the lobby size this supports depends on the team
 * count. Checked up front so an oversized lobby gets a clear error instead of
 * a TransactionCanceledException.
 */
const MAX_TRANSACT_ITEMS = 100;

/** Statuses from which teams may still be (re-)drawn. */
const RANDOMIZABLE = new Set(["LOBBY", "TEAMS_SET"]);

function defaultTeamName(index: number): string {
  return `Team ${index + 1}`;
}

export async function randomizeTeams(args: Record<string, unknown>): Promise<GameUpdate> {
  const gameId = requiredString(args, "gameId");
  const gmToken = requiredString(args, "gmToken");
  const teamCount = requiredInt(args, "teamCount", { min: 1 });

  const meta = await getItem(keys.gameMeta(gameId));
  if (!meta) throw new NotFoundError("No such game");
  assertGm(gmToken, typeof meta.gmTokenHash === "string" ? meta.gmTokenHash : undefined);

  const game = toGame(meta);
  if (!RANDOMIZABLE.has(game.status)) {
    throw new ConflictError("Teams can only be randomized before the first round starts");
  }

  const pk = keys.gamePk(gameId);
  const [playerItems, teamItems, roundItems] = await Promise.all([
    queryPrefix(pk, keys.prefixes.players()),
    queryPrefix(pk, keys.prefixes.teams()),
    queryPrefix(pk, keys.prefixes.rounds()),
  ]);

  // Re-drawing teams after a round exists would orphan that round's responses,
  // which are keyed by team id.
  if (roundItems.length > 0) {
    throw new ConflictError("Teams cannot be randomized once a round has been created");
  }

  const players = playerItems.map(toPlayer);
  if (players.length === 0) {
    throw new ValidationError("Cannot randomize teams before any player has joined");
  }
  if (teamCount > players.length) {
    throw new ValidationError(
      `teamCount (${teamCount}) cannot exceed the number of players (${players.length})`,
    );
  }

  const required = teamItems.length + teamCount + players.length + 1;
  if (required > MAX_TRANSACT_ITEMS) {
    throw new ConflictError(
      `This game is too large to re-draw teams atomically (${required} writes, limit ${MAX_TRANSACT_ITEMS})`,
    );
  }

  // The core shuffle is the only place players are ordered; this handler just
  // persists whatever it deals out.
  const dealt = splitIntoTeams(
    players.map((player) => player.id),
    teamCount,
  );

  const table = tableName();
  const newTeams: Team[] = [];
  const teamIdByPlayer = new Map<string, string>();
  const writes: Parameters<typeof transactWrite>[0] = [];

  for (const item of teamItems) {
    writes.push({ Delete: { TableName: table, Key: { pk: item.pk, sk: item.sk } } });
  }

  dealt.forEach((playerIds, index) => {
    const teamId = newTeamId();
    const team: Team = {
      id: teamId,
      name: defaultTeamName(index),
      score: 0,
      doubleUsedRound: null,
    };
    newTeams.push(team);
    const item: TeamItem = {
      ...keys.team(gameId, teamId),
      name: team.name,
      score: team.score,
      doubleUsedRound: team.doubleUsedRound,
    };
    writes.push({ Put: { TableName: table, Item: item } });
    for (const playerId of playerIds) {
      teamIdByPlayer.set(playerId, teamId);
    }
  });

  const assigned: Player[] = players.map((player) => {
    const teamId = teamIdByPlayer.get(player.id);
    if (teamId === undefined) {
      // splitIntoTeams deals every id it is given, so this cannot happen.
      throw new Error(`Player ${player.id} was not dealt a team`);
    }
    writes.push({
      Update: {
        TableName: table,
        Key: keys.player(gameId, player.id),
        UpdateExpression: "SET teamId = :teamId",
        ExpressionAttributeValues: { ":teamId": teamId },
      },
    });
    return { ...player, teamId };
  });

  writes.push({
    Update: {
      TableName: table,
      Key: keys.gameMeta(gameId),
      UpdateExpression: "SET #status = :teamsSet",
      // Re-checks the status inside the transaction, so a concurrent startRound
      // loses rather than silently having its teams pulled out from under it.
      ConditionExpression: "#status IN (:lobby, :teamsSet)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":lobby": "LOBBY", ":teamsSet": "TEAMS_SET" },
    },
  });

  await transactWrite(writes);

  // Built from what was just written rather than re-read: a follow-up read is
  // eventually consistent and could return the pre-transaction teams.
  const snapshot = assembleGame({ ...game, status: "TEAMS_SET" }, assigned, newTeams, []);
  return gameUpdate(snapshot, "TEAMS_SET");
}
