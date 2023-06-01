export interface CakeRevisionConfig {
  /** node-websql file path */
  filename: string;

  /** couchdb servers */
  remotes?: {
    url: string;
  }[];
}

export interface CakeMainDatabaseConfig {
  client: "sqlite3" | "better-sqlite3";
  connection: {
    filename: string;
  };

  migrations?: {
    directory: string;
    tableName: string;
  };
}

export interface CakeDBConfig {
  /** main database */
  main: CakeMainDatabaseConfig;

  /** revision database */
  revision: CakeRevisionConfig;

  /** cakedb check point */
  checkPoint?: {
    server: string;
  };

  /** auto recover main database from revision database. default: true */
  autoRecovery?: boolean;

  autoMigrate?: boolean;
}
