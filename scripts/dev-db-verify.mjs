import { matchesAppliedMigrationChecksum } from "./migration-checksum.mjs";

export const appliedMigrationsSelect = "SELECT file_name, sha256 FROM centerpro_setup.applied_migrations";

export async function verifyMigrationHistory(client, localMigrations) {
  let rows;
  try {
    ({ rows } = await client.query(appliedMigrationsSelect));
  } catch (error) {
    if (error?.code === "42P01" || error?.code === "3F000") {
      throw new Error("Migration history table centerpro_setup.applied_migrations is missing.");
    }
    throw new Error("Could not read development migration history.");
  }

  const localByName = new Map(localMigrations.map(migration => [migration.name, migration]));
  const appliedNames = new Set(rows.map(row => row.file_name));
  const missingLocalFiles = [];
  const checksumMismatches = [];
  let appliedVerifiedCount = 0;

  for (const row of rows) {
    const local = localByName.get(row.file_name);
    if (!local) {
      missingLocalFiles.push(row.file_name);
    } else if (!matchesAppliedMigrationChecksum(row.sha256, local.sql)) {
      checksumMismatches.push(row.file_name);
    } else {
      appliedVerifiedCount += 1;
    }
  }

  const pending = localMigrations.filter(migration => !appliedNames.has(migration.name)).map(migration => migration.name);
  return {
    appliedVerifiedCount,
    pending,
    missingLocalFiles,
    checksumMismatches,
    pass: missingLocalFiles.length === 0 && checksumMismatches.length === 0,
  };
}
