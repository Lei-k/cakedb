import knex, { Knex } from "knex";
import { CakeDBConfig } from "../types";
import RevisionManager from "./revision-manager";

class CakeDB {
  config: CakeDBConfig;

  mainDatabase: Knex;

  revisionManager: RevisionManager;

  constructor(config: CakeDBConfig) {
    this.config = config;

    this.mainDatabase = knex(config.main);

    this.revisionManager = new RevisionManager(
      this.mainDatabase,
      config.revision
    );
  }

  get db() {
    return this.mainDatabase;
  }

  async init() {
    try {
      await this.revisionManager.sync({ mode: "once" });
    } catch (err) {}

    this.revisionManager.sync({ mode: "live" });

    if (this.config.autoRecovery !== false) {
      await this.revisionManager.recovery();
    }

    if (this.config.autoMigrate !== false) {
      await this.mainDatabase.migrate.up();
    }
  }

  async close() {
    await this.revisionManager.close();

    await this.mainDatabase.destroy();
  }
}

export default CakeDB;
