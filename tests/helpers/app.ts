import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IgnitorFactory } from '@adonisjs/core/factories'
import { defineConfig } from '@adonisjs/lucid'
import type { Database } from '@adonisjs/lucid/database'
import type { ApplicationService } from '@adonisjs/core/types'

let application: ApplicationService | undefined
let database: Database | undefined

export function getDb() {
  if (!database) {
    throw new Error('Test application is not booted')
  }
  return database
}

export async function bootTestApp() {
  if (application) {
    return application
  }

  const filename = join(mkdtempSync(join(tmpdir(), 'adonis-lucid-')), 'db.sqlite')
  const ignitor = new IgnitorFactory()
    .withCoreProviders()
    .withCoreConfig()
    .merge({
      rcFileContents: {
        providers: [() => import('@adonisjs/lucid/database_provider')],
      },
      config: {
        database: defineConfig({
          connection: 'sqlite',
          connections: {
            sqlite: {
              client: 'better-sqlite3',
              connection: { filename },
              useNullAsDefault: true,
              pool: { min: 1, max: 1 },
            },
          },
        }),
      },
    })
    .create(new URL('../../', import.meta.url), {
      importer: (filePath) => import(filePath),
    })

  application = ignitor.createApp('test')
  await application.init()
  await application.boot()

  database = await application.container.make('lucid.db')
  await createSchema(database)
  return application
}

async function createSchema(db: Database) {
  const schema = () => db.connection().schema
  await schema().createTable('users', (table) => {
    table.increments('id')
    table.string('name').notNullable()
    table.string('email').nullable()
    table.string('role').nullable()
    table.boolean('active').nullable()
    table.text('secret').nullable()
    table.text('meta').nullable()
    table.timestamp('created_at').nullable()
    table.timestamp('updated_at').nullable()
  })
  await schema().createTable('profiles', (table) => {
    table.increments('id')
    table.integer('user_id').notNullable()
    table.string('bio').nullable()
  })
  await schema().createTable('posts', (table) => {
    table.increments('id')
    table.integer('user_id').notNullable()
    table.string('title').notNullable()
    table.text('body').nullable()
    table.timestamp('published_at').nullable()
    table.timestamp('created_at').nullable()
    table.timestamp('updated_at').nullable()
  })
  await schema().createTable('comments', (table) => {
    table.increments('id')
    table.integer('post_id').notNullable()
    table.string('body').notNullable()
  })
}

export async function shutdownTestApp() {
  if (!application) {
    return
  }
  await application.terminate()
  application = undefined
  database = undefined
}
