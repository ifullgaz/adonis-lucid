import { compose } from '@adonisjs/core/helpers'
import { BaseModel, belongsTo, column, computed, hasMany, hasOne } from '@adonisjs/lucid/orm'
import { SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'
import type { ModelAttributes } from '@adonisjs/lucid/types/model'
import type { BelongsTo, HasMany, HasOne } from '@adonisjs/lucid/types/relations'
import { type DateTime } from 'luxon'
import { withScopedModel } from '../../src/models/traits/scoped_model.ts'
import boolean from '../../src/models/columns/boolean.ts'
import jsonColumn from '../../src/models/columns/json.ts'
import dateTime from '../../src/models/columns/date_time.ts'
import password from '../../src/models/columns/password.ts'
import '../../src/scopes/main.ts'
import { getDb } from './app.ts'

BaseModel.namingStrategy = new SnakeCaseNamingStrategy()

export class User extends compose(BaseModel, withScopedModel()) {
  static table = 'users'

  static defaultValues: Partial<ModelAttributes<User>> | (() => Partial<ModelAttributes<User>>) = {}

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare email: string | null

  @column()
  declare role: string | null

  @boolean()
  declare active: boolean | null

  @password()
  declare secret: string | null

  @jsonColumn()
  declare meta: Record<string, unknown> | null

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @computed()
  get label() {
    return this.$extras.label as string | undefined
  }

  set label(value: string | undefined) {
    this.$extras.label = value
  }

  @hasMany(() => Post)
  declare posts: HasMany<typeof Post>

  @hasMany(() => Post, {
    foreignKey: 'userId',
    onQuery: (query) => {
      query.preload('comments')
    },
  })
  declare auditedPosts: HasMany<typeof Post>

  @hasOne(() => Profile)
  declare profile: HasOne<typeof Profile>
}

export class Profile extends BaseModel {
  static table = 'profiles'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare bio: string | null

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}

export class Post extends BaseModel {
  static table = 'posts'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare title: string

  @column()
  declare body: string | null

  @dateTime()
  declare publishedAt: DateTime | null

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare createdAt: DateTime | null

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @hasMany(() => Comment)
  declare comments: HasMany<typeof Comment>
}

export class Comment extends BaseModel {
  static table = 'comments'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare postId: number

  @column()
  declare body: string

  @belongsTo(() => Post)
  declare post: BelongsTo<typeof Post>
}

export class Label extends BaseModel {
  static table = 'labels'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string
}

export class CreatedOnly extends BaseModel {
  static table = 'created_only'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}

export async function resetDatabase() {
  const db = getDb()
  await db.from('comments').delete()
  await db.from('posts').delete()
  await db.from('profiles').delete()
  await db.from('users').delete()
  User.defaultValues = { role: 'member', active: true }
}

export function compiled(query: { toSQL(): { sql: string; bindings: readonly unknown[] } }) {
  const compiledQuery = query.toSQL()
  return {
    sql: compiledQuery.sql.replace(/[`"]/g, ''),
    bindings: compiledQuery.bindings,
  }
}
