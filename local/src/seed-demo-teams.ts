/**
 * Idempotent local demo teams for join autocomplete and first-signup flows.
 *
 * Seeds two clubs with one team admin each. Set `AUTH_SEED_USER_ID` to either
 * admin id to Continue as that club; Compose defaults to the Seacoast admin.
 *
 * - Peoria Pigs — Peoria, IL (`America/Chicago`)
 * - Seacoast Men's Rugby — Portsmouth, NH (`America/New_York`)
 *
 * `npm run db:seed` passes `--reset`, which deletes every row that is not part
 * of these clubs before writing them. Container startup runs this script
 * without that flag, so a restart leaves other local teams in place.
 */

import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { putProfile, getProfile } from '../../functions/lib/auth/profile.js';
import { DEFAULT_ROLE_PERMISSIONS, TEAM_ROLES } from '@gameplan/types';
import {
  TABLE_PK,
  TABLE_SK,
  chatMemberSk,
  chatMetaSk,
  chatPk,
  deleteItem,
  getDocClient,
  getItem,
  profileSk,
  putItem,
  teamDirectoryPk,
  teamDirectorySk,
  teamMemberSk,
  teamMetaSk,
  teamPk,
  rolePermissionsSk,
  transactWrite,
  userChatSk,
  userPk,
  userTeamSk,
} from '../../functions/lib/dynamo/index.js';
import { TABLE_NAME } from '../../functions/lib/names.js';

/** Stable birthday so seeded admins look like complete adult profiles. */
const ADMIN_BIRTHDAY = '1985-06-15';

type DemoTeamSeed = {
  teamId: string;
  chatId: string;
  name: string;
  /** City or region shown in search and on the admin settings form. */
  location: string;
  timeZone: string;
  admin: {
    userId: string;
    email: string;
    displayName: string;
  };
};

/** Fixed demo teams written into DynamoDB Local. */
const DEMO_TEAMS: readonly DemoTeamSeed[] = [
  {
    teamId: '11111111-1111-4111-8111-111111111111',
    chatId: '11111111-1111-4111-8111-111111111112',
    name: 'Peoria Pigs',
    location: 'Peoria, IL',
    timeZone: 'America/Chicago',
    admin: {
      userId: '22222222-2222-4222-8222-222222222222',
      email: 'peoria-admin@localhost',
      displayName: 'Riley Peoria',
    },
  },
  {
    teamId: '33333333-3333-4333-8333-333333333333',
    chatId: '33333333-3333-4333-8333-333333333334',
    name: "Seacoast Men's Rugby",
    location: 'Portsmouth, NH',
    timeZone: 'America/New_York',
    admin: {
      userId: '44444444-4444-4444-8444-444444444444',
      email: 'seacoast-admin@localhost',
      displayName: 'Morgan Seacoast',
    },
  },
];

/** Flag passed by `npm run db:seed` to drop rows that are not part of the demo clubs. */
const RESET_FLAG = '--reset';

/**
 * Builds the primary keys written for the demo clubs.
 *
 * A reset keeps these rows and deletes every other item in the table.
 *
 * @returns Keys as `PK` and `SK` joined by a null character.
 */
const seedItemKeys = (): Set<string> => {
  const keys = new Set<string>();
  const add = (pk: string, sk: string): void => {
    keys.add(`${pk}\0${sk}`);
  };
  for (const seed of DEMO_TEAMS) {
    add(teamPk(seed.teamId), teamMetaSk());
    for (const role of TEAM_ROLES) add(teamPk(seed.teamId), rolePermissionsSk(role));
    add(teamPk(seed.teamId), teamMemberSk(seed.admin.userId));
    add(teamDirectoryPk(), teamDirectorySk(seed.name, seed.teamId));
    add(chatPk(seed.chatId), chatMetaSk());
    add(chatPk(seed.chatId), chatMemberSk(seed.admin.userId));
    add(userPk(seed.admin.userId), profileSk());
    add(userPk(seed.admin.userId), userTeamSk(seed.teamId));
    add(userPk(seed.admin.userId), userChatSk(seed.chatId));
  }
  return keys;
};

/**
 * Deletes every table row that is not part of the demo clubs.
 *
 * @returns How many rows were deleted.
 */
const removeNonSeedItems = async (): Promise<number> => {
  const keep = seedItemKeys();
  let removed = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await getDocClient().send(
      new ScanCommand({
        TableName: TABLE_NAME,
        ExclusiveStartKey: exclusiveStartKey,
        ProjectionExpression: '#pk, #sk',
        ExpressionAttributeNames: { '#pk': TABLE_PK, '#sk': TABLE_SK },
      }),
    );
    for (const item of page.Items ?? []) {
      const pk = String(item[TABLE_PK]);
      const sk = String(item[TABLE_SK]);
      if (keep.has(`${pk}\0${sk}`)) continue;
      await deleteItem(pk, sk);
      removed += 1;
    }
    exclusiveStartKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey !== undefined);
  return removed;
};

/**
 * Ensures one demo admin profile exists.
 *
 * @param admin - The admin identity for a demo team.
 */
const ensureAdmin = async (admin: DemoTeamSeed['admin']): Promise<void> => {
  const existing = await getProfile(admin.userId);
  if (existing !== undefined) return;
  await putProfile({
    userId: admin.userId,
    email: admin.email,
    displayName: admin.displayName,
    accountKind: 'adult',
    birthday: ADMIN_BIRTHDAY,
  });
};

/**
 * Renames a demo default chat that was stored as the generic label.
 *
 * Existing local databases already have the team row, so the create path is
 * skipped. The chat list reads this name from the chat metadata row.
 *
 * @param seed - The fixed demo team definition.
 */
const renameLegacyDefaultChat = async (seed: DemoTeamSeed): Promise<void> => {
  const chat = await getItem<Record<string, unknown>>(chatPk(seed.chatId), chatMetaSk());
  if (chat === undefined || chat.name !== 'Team chat') return;
  await putItem({ ...chat, name: seed.name });
};

/**
 * Writes the searchable directory row for a demo team.
 *
 * A team that already exists skips the create path, so a reseed still refreshes
 * this row. Search filters on `nameSearch`, and older rows do not have it.
 *
 * @param seed - The fixed demo team definition.
 */
const writeDirectory = async (seed: DemoTeamSeed): Promise<void> => {
  await putItem({
    [TABLE_PK]: teamDirectoryPk(),
    [TABLE_SK]: teamDirectorySk(seed.name, seed.teamId),
    teamId: seed.teamId,
    name: seed.name,
    nameSearch: seed.name.trim().toLowerCase(),
    timeZone: seed.timeZone,
    location: seed.location,
  });
};

/**
 * Creates one demo team, default chat, directory row, and admin membership.
 *
 * Skips the create when the team metadata row already exists, but still renames
 * a default chat left over from the generic label and refreshes the directory row.
 *
 * @param seed - The fixed demo team definition.
 */
const ensureTeam = async (seed: DemoTeamSeed): Promise<'created' | 'exists'> => {
  const existing = await getItem(teamPk(seed.teamId), teamMetaSk());
  if (existing !== undefined) {
    await renameLegacyDefaultChat(seed);
    await writeDirectory(seed);
    return 'exists';
  }

  await ensureAdmin(seed.admin);

  const createdAt = new Date().toISOString();
  const table = TABLE_NAME;
  const team = {
    [TABLE_PK]: teamPk(seed.teamId),
    [TABLE_SK]: teamMetaSk(),
    teamId: seed.teamId,
    name: seed.name,
    timeZone: seed.timeZone,
    defaultChatId: seed.chatId,
    createdBy: seed.admin.userId,
    createdAt,
    location: seed.location,
  };

  const rolePuts = TEAM_ROLES.map((role) => ({
    Put: {
      TableName: table,
      Item: {
        [TABLE_PK]: teamPk(seed.teamId),
        [TABLE_SK]: rolePermissionsSk(role),
        role,
        permissions: [...DEFAULT_ROLE_PERMISSIONS[role]],
      },
    },
  }));

  await transactWrite([
    { Put: { TableName: table, Item: team } },
    {
      Put: {
        TableName: table,
        Item: {
          [TABLE_PK]: teamDirectoryPk(),
          [TABLE_SK]: teamDirectorySk(seed.name, seed.teamId),
          teamId: seed.teamId,
          name: seed.name,
          nameSearch: seed.name.trim().toLowerCase(),
          timeZone: seed.timeZone,
          location: seed.location,
        },
      },
    },
    ...rolePuts,
    {
      Put: {
        TableName: table,
        Item: {
          [TABLE_PK]: chatPk(seed.chatId),
          [TABLE_SK]: chatMetaSk(),
          chatId: seed.chatId,
          kind: 'default',
          teamId: seed.teamId,
          name: seed.name,
          createdAt,
        },
      },
    },
    {
      Put: {
        TableName: table,
        Item: {
          [TABLE_PK]: teamPk(seed.teamId),
          [TABLE_SK]: teamMemberSk(seed.admin.userId),
          userId: seed.admin.userId,
          role: 'team_admin',
          joinedAt: createdAt,
        },
      },
    },
    {
      Put: {
        TableName: table,
        Item: {
          [TABLE_PK]: userPk(seed.admin.userId),
          [TABLE_SK]: userTeamSk(seed.teamId),
          teamId: seed.teamId,
          role: 'team_admin',
          joinedAt: createdAt,
        },
      },
    },
    {
      Put: {
        TableName: table,
        Item: {
          [TABLE_PK]: chatPk(seed.chatId),
          [TABLE_SK]: chatMemberSk(seed.admin.userId),
          userId: seed.admin.userId,
          joinedAt: createdAt,
        },
      },
    },
    {
      Put: {
        TableName: table,
        Item: {
          [TABLE_PK]: userPk(seed.admin.userId),
          [TABLE_SK]: userChatSk(seed.chatId),
          chatId: seed.chatId,
          teamId: seed.teamId,
          kind: 'default',
        },
      },
    },
  ]);

  return 'created';
};

/**
 * Seeds both demo clubs when missing.
 *
 * With `--reset`, rows outside the demo clubs are deleted first.
 */
const main = async (): Promise<void> => {
  if (process.argv.includes(RESET_FLAG)) {
    const removed = await removeNonSeedItems();
    console.info(`removed ${removed} rows outside the demo seed`);
  }
  for (const seed of DEMO_TEAMS) {
    const result = await ensureTeam(seed);
    console.info(
      `${result === 'created' ? 'seeded' : 'kept'} ${seed.name} (${seed.location}) admin=${seed.admin.email}`,
    );
  }
};

await main();
