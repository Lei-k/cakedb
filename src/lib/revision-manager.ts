import PouchDB from "pouchdb";

import PouchdbFind from "pouchdb-find";

import adapter from "pouchdb-adapter-node-websql";

import crypto from "crypto";

import fs from "fs";

import path from "path";

import makeKV, { KV } from "./kv";

import { CakeRevisionConfig } from "../types";
import { Knex } from "knex";

PouchDB.plugin(PouchdbFind);
PouchDB.plugin(adapter);

type RevisionStatus = "pending" | "commit" | "failure";

type Revision = {
  type: "revision";
  command: string;
  status: RevisionStatus;
  createTime: number;
  commitTime: number | null;
};

type RemoteDatabase = {
  db: PouchDB.Database<Revision>;
  isChangeEventFired: boolean;
  isActiveEventFired: boolean;
  isLive: boolean;
  syncHandler?: PouchDB.Replication.Sync<{}>;
};

class RevisionManager {
  private db: PouchDB.Database<Revision>;

  mainDB: Knex;

  config: CakeRevisionConfig;

  remotes: RemoteDatabase[];

  isLive: boolean;

  isRecorving: boolean;

  lastRevision?: string;

  kv: KV;

  constructor(mainDB: Knex, config: CakeRevisionConfig) {
    this.config = config;

    this.mainDB = mainDB;

    this.kv = makeKV(this.mainDB);

    if (!fs.existsSync(this.config.filename)) {
      let revisionDir = path.dirname(this.config.filename);

      let fname = path.basename(this.config.filename);

      let regex = new RegExp("^" + fname, "i");

      let files = fs.readdirSync(revisionDir);

      for (let i = 0; i < files.length; i++) {
        if (regex.test(files[i])) {
          console.log("delete", path.join(revisionDir, files[i]));
          fs.unlinkSync(path.join(revisionDir, files[i]));
        }
      }
    }

    this.db = new PouchDB(this.config.filename, {
      adapter: "websql",
    });

    this.remotes = [];

    this.isRecorving = false;

    this.isLive = false;

    this.init();
  }

  private init() {
    this.initRemotes();

    this.listenMainDBChange();
  }

  private initRemotes() {
    this.remotes = [];

    if (!this.config.remotes) {
      return;
    }

    this.config.remotes.forEach((r) => {
      this.remotes.push({
        db: new PouchDB(r.url),
        isLive: false,
        isActiveEventFired: false,
        isChangeEventFired: false,
      });
    });
  }

  private listenMainDBChange() {
    // listen db change

    const excludeSubscribeCommands = ["select"];

    this.mainDB.on(
      "query-response",
      (resp, obj, builder: Knex.QueryBuilder) => {
        if (
          obj.bindings instanceof Array &&
          obj.bindings.includes("revision_point")
        ) {
          return;
        }

        if (this.isRecorving) return;

        let oriSql = builder.toString() as string;
        let sql = oriSql.toLowerCase();

        let shouldWrite = true;

        for (let i = 0; i < excludeSubscribeCommands.length; i++) {
          let exclude = excludeSubscribeCommands[i];

          if (sql.startsWith(exclude)) {
            shouldWrite = false;
            break;
          }
        }

        if (!shouldWrite) {
          return;
        }

        console.log("obj", obj);

        const afterCommit = async (revisionId: string) => {
          try {
            let oldRevision = await this.kv.get("revision_point");

            if (oldRevision === revisionId) return;

            await this.kv.put("revision_point", revisionId);
          } catch (err) {
            console.error(err);
          }
        };

        this.writeAndCommit(builder.toString())
          .then((result) => {
            if (this.lastRevision !== result.id) return;

            afterCommit(result.id);
          })
          .catch((err) => {
            console.error(err);
          });
      }
    );
  }

  async sync({ mode = "once" }: { mode: "once" | "live" }) {
    await Promise.all(this.remotes.map((r) => this.syncRemote(r, { mode })));
  }

  private async syncRemote(
    remote: RemoteDatabase,
    { mode = "once" }: { mode: "once" | "live" }
  ) {
    let opts: PouchDB.Replication.SyncOptions = {};

    if (mode === "live") {
      opts.live = true;
      opts.retry = true;
    }

    let syncHandler = this.db.sync(remote.db, opts);

    remote.syncHandler = syncHandler;

    if (mode === "once") {
      await new Promise((resolve, reject) => {
        syncHandler
          .on("complete", () => {
            resolve("complete");
          })
          .on("error", (err) => {
            reject(err);
          });
      });
    } else {
      // listen change/pause/active event

      syncHandler
        .on("active", () => {
          remote.isActiveEventFired = true;
        })
        .on("paused", () => {
          if (remote.isActiveEventFired && !remote.isChangeEventFired) {
            console.log("user went offline");
          } else if (remote.isActiveEventFired && remote.isChangeEventFired) {
            console.log("user went online");

            remote.isLive = true;
          }

          remote.isActiveEventFired = false;
          remote.isChangeEventFired = false;
        })
        .on("change", (change) => {
          remote.isChangeEventFired = true;

          console.log("change: ", JSON.stringify(change));
        })
        .on("error", (err) => {
          // never happen
          console.error(err);
        });
    }
  }

  async write(command: any) {
    let now = new Date();

    let id = crypto.randomUUID();

    this.lastRevision = id;

    await this.db.put({
      _id: id,
      type: "revision",
      command,
      status: "pending",
      createTime: now.getTime(),
      commitTime: null,
    });
  }

  async writeAndCommit(command: any) {
    let now = new Date();

    let id = crypto.randomUUID();

    this.lastRevision = id;

    return await this.db.put({
      _id: id,
      type: "revision",
      command,
      status: "commit",
      createTime: now.getTime(),
      commitTime: now.getTime(),
    });
  }

  async update(
    id: string,
    params: {
      status?: RevisionStatus;
      commitTime?: number;
    }
  ) {
    let payload = {
      _id: id,
      ...params,
    };

    let result = await this.db.put(payload as any);

    return result;
  }

  private async findIndexes(ddoc: string) {
    let { indexes } = await this.db.getIndexes();

    let finded: PouchDB.Find.Index[] = [];

    for (let i = 0; i < indexes.length; i++) {
      if (indexes[i].ddoc === "_design/" + ddoc) {
        finded.push(indexes[i]);
      }
    }

    return finded;
  }

  /**
   * recovery database by revisions
   */
  async recovery() {
    this.isRecorving = true;

    try {
      let revisionPoint: string | undefined = undefined;

      let findedIdxes = await this.findIndexes("revision:commitTime&type");

      for (let i = 0; i < findedIdxes.length; i++) {
        await this.db.deleteIndex(findedIdxes[i] as any);
      }

      await this.db.createIndex({
        index: {
          ddoc: "revision:commitTime&type",
          fields: ["commitTime", "type"],
        },
      });

      try {
        revisionPoint = await this.kv.get("revision_point");
      } catch (err) {}

      let opts: PouchDB.Find.FindRequest<{}> = {
        selector: {
          $and: [
            {
              commitTime: {
                $gt: 1,
              },
            },
            {
              type: {
                $eq: "revision",
              },
            },
          ],
        },
        fields: ["_id", "commitTime", "command"],
        sort: [
          {
            commitTime: "asc",
          },
        ],
      };

      if (revisionPoint) {
        let revision = await this.db.get<Revision>(revisionPoint);

        opts.selector.$and!.push({
          commitTime: {
            $gt: revision.commitTime,
          },
        });
      }

      let revisions = (await this.db.find(opts)).docs;

      if (revisions.length <= 0) return;

      console.log("revision length:", revisions.length);

      for (let i = 0; i < revisions.length; i++) {
        let revision = revisions[i];

        await this.mainDB.raw(revision.command);

        let kvExists = await this.mainDB.schema.hasTable("kv");

        if (kvExists) {
          await this.kv.put("revision_point", revision._id);

          revisionPoint = revision._id;
        }
      }
    } catch (err) {
      throw err;
    } finally {
      this.isRecorving = false;
    }

    console.log("recovery success");
  }

  async read(opts?: { timestamp: number }) {}

  live() {
    for (let i = 0; i < this.remotes.length; i++) {
      let r = this.remotes[i];

      if (r.isLive) return true;
    }

    return false;
  }

  async close() {
    for (let i = 0; i < this.remotes.length; i++) {
      let r = this.remotes[i];

      if (r.syncHandler) {
        r.syncHandler.cancel();
      }

      await r.db.close();
    }

    await this.db.close();
  }
}

export default RevisionManager;
