import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('kv', table => {
        table.string('key', 256).notNullable().primary();
        table.string('value', 2048);
    });

    await knex.schema.createTable('todo', table => {
        table.increments('id').unsigned().primary();
        table.string('title', 256).notNullable();
        table.string('content', 2048).notNullable();
    })
}


export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTable('todo');
    await knex.schema.dropTable('kv');
}

