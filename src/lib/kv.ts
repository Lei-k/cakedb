import { Knex } from "knex";

export type KV = {
	get: (key: string) => Promise<string>;
	put: (key: string, value: string) => Promise<void>
}

function makeKV(db: Knex) {
  async function get(key: string) {
    let kv = await db("kv")
      .select()
      .where({
        key,
      })
      .first();

    if (!kv) return undefined;

    return kv.value as string;
  }

  async function put(key: string, value: string) {
    let old = await get(key);

    if (!old) {
      await db("kv").insert({
        key,
        value,
      });
    } else {
      await db("kv")
        .update({
          value,
        })
        .where({ key });
    }
  }

  return {
    get,
    put,
  } as KV;
}

export default makeKV;

