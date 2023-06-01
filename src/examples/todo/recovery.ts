import { CakeDBConfig } from '../../types';

import path from 'path';
import CakeDB from '../../lib/cakedb';


async function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(1);
    }, ms);
  });
}

const cakeConfig: CakeDBConfig = {
  main: {
    client: "sqlite3",
    connection: {
      filename: path.join(__dirname, "todo_new.db"),
    },

    migrations: {
      directory: path.join(__dirname, "migrations"),
      tableName: "migrations",
    },
  },

  revision: {
    filename: path.join(__dirname, "revision.db"),
		remotes: [{
			url: 'http://todo-app:todopass@localhost:5984/todo'
		}]
  },
};

async function main() {
	let cake = new CakeDB(cakeConfig);

	await cake.init();

	await delay(1000);

	await cake.close();
}

main();
