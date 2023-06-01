import CakeDB, { CakeDBConfig } from "../../index";

import path from "path";

import fs from "fs";

const cakeConfig: CakeDBConfig = {
  main: {
    client: "sqlite3",
    connection: {
      filename: path.join(__dirname, "todo.db"),
    },

    migrations: {
      directory: path.join(__dirname, "migrations"),
      tableName: "migrations",
    },
  },

  revision: {
    filename: path.join(__dirname, "revision.db"),
		remotes: [
			{
				url: 'http://todo-app:todopass@localhost:5984/todo'
			}
		]
  },
};


const INSERT_ROWS = 100;

async function cleanUp() {
  try {
    await fs.promises.unlink(cakeConfig.revision.filename);

    await fs.promises.unlink(cakeConfig.main.connection.filename);

  } catch (err) {}
}

async function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(1);
    }, ms);
  });
}

async function main() {
  await cleanUp();

  let cake = new CakeDB(cakeConfig);

  await cake.init();

  const { db } = cake;

  let inserts = new Array(INSERT_ROWS).fill(1).map((_, idx) => {
    const ins = async () => {
      return await db("todo").insert({
        title: "title_" + idx,
        content: "content_" + idx,
      });
    };

    return ins();
  });

  await Promise.all(inserts);

  // wait for background work
  await delay(3000);

  await cake.close();
}

main();
