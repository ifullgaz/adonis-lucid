import { test } from '@japa/runner'
import { HttpContext } from '@adonisjs/core/http'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import boolean from '../src/models/columns/boolean.ts'
import jsonColumn from '../src/models/columns/json.ts'
import dateTime from '../src/models/columns/date_time.ts'
import password from '../src/models/columns/password.ts'
import { Post, User, resetDatabase } from './helpers/models.ts'

class Flag extends BaseModel {
  static table = 'users'

  @boolean({ meta: { foo: 'bar', type: 'string' } })
  declare active: boolean
}

class Stamp extends BaseModel {
  static table = 'posts'

  @dateTime({ autoCreate: true, meta: { format: 'yyyy-LL-dd' } })
  declare createdAt: DateTime
}

class Credential extends BaseModel {
  static table = 'users'

  @password({ serializeAs: 'secret' })
  declare secret: string | null
}

class Payload extends BaseModel {
  static table = 'users'

  @jsonColumn()
  declare meta: unknown

  @column()
  declare name: string
}

function columnOf<T extends typeof BaseModel>(model: T, name: string) {
  const definition = model.$getColumn(name)
  if (!definition) {
    throw new Error(`Missing column ${name}`)
  }
  return definition
}

function withHeaders<T>(headers: Record<string, string | undefined>, run: () => T) {
  const original = HttpContext.get
  HttpContext.get = () => {
    return {
      request: {
        header(name: string) {
          return headers[name]
        },
      },
    } as HttpContext
  }
  try {
    return run()
  } finally {
    HttpContext.get = original
  }
}

test.group('column decorators', (group) => {
  group.each.setup(async () => {
    await resetDatabase()
  })

  test('boolean columns persist bits and consume booleans', ({ assert }) => {
    const definition = columnOf(User, 'active')
    assert.equal(definition.meta?.type, 'boolean')
    assert.equal(definition.prepare!(true, 'active', new User()), 1)
    assert.equal(definition.prepare!(false, 'active', new User()), 0)
    assert.equal(definition.prepare!(0, 'active', new User()), 0)
    assert.equal(definition.prepare!('yes', 'active', new User()), 1)
    assert.isFalse(definition.consume!(0, 'active', new User()))
    assert.isTrue(definition.consume!(1, 'active', new User()))
    assert.isFalse(definition.consume!(null, 'active', new User()))

    const overridden = columnOf(Flag, 'active')
    assert.equal(overridden.meta?.type, 'boolean')
    assert.equal(overridden.meta?.foo, 'bar')
  })

  test('boolean serialization follows the request format', async ({ assert }) => {
    const user = await User.store({ name: 'Ada', active: true })
    const inactive = await User.store({ name: 'Bea', active: false })
    const definition = columnOf(User, 'active')

    assert.equal(user.serialize().active, true)
    assert.equal(definition.serialize!(true, 'active', user), true)

    withHeaders({}, () => {
      assert.equal(definition.serialize!(true, 'active', user), 'Y')
      assert.equal(definition.serialize!(false, 'active', user), 'N')
    })
    withHeaders({ 'Bool-Format': 'int' }, () => {
      assert.equal(definition.serialize!(true, 'active', user), 1)
      assert.equal(definition.serialize!(false, 'active', user), 0)
    })
    withHeaders({ 'Bool-Format': 'bool' }, () => {
      assert.equal(definition.serialize!(true, 'active', user), true)
      assert.equal(definition.serialize!(0, 'active', user), false)
    })
    withHeaders({ 'Bool-Format': 'alpha' }, () => {
      assert.equal(user.serialize().active, 'Y')
      assert.equal(inactive.serialize().active, 'N')
    })
    withHeaders({ 'Bool-Format': 'other' }, () => {
      assert.equal(definition.serialize!(true, 'active', user), true)
    })
    withHeaders({ 'App-Name': 'mobile' }, () => {
      assert.equal(definition.serialize!(true, 'active', user), true)
    })
    withHeaders({ 'App-Name': 'mobile', 'Bool-Format': 'alpha' }, () => {
      assert.equal(definition.serialize!(false, 'active', user), 'N')
    })
    withHeaders({}, () => {
      const context = HttpContext.get()
      assert.isDefined(context)
      HttpContext.get = () => ({}) as HttpContext
      assert.equal(definition.serialize!(true, 'active', user), true)
    })
  })

  test('json columns stringify, parse, and pass nulls through', ({ assert }) => {
    const definition = columnOf(Payload, 'meta')
    assert.equal(definition.meta?.type, 'json')
    assert.isNull(definition.prepare!(null, 'meta', new Payload()))
    assert.isUndefined(definition.prepare!(undefined, 'meta', new Payload()))
    assert.equal(definition.prepare!({ a: 1 }, 'meta', new Payload()), '{"a":1}')
    assert.equal(definition.prepare!([1, 2], 'meta', new Payload()), '[1,2]')
    assert.deepEqual(definition.consume!('{"a":1}', 'meta', new Payload()), { a: 1 })
    assert.equal(definition.consume!('{nope', 'meta', new Payload()), '{nope')
    assert.isNull(definition.consume!(null, 'meta', new Payload()))
    assert.isUndefined(definition.consume!(undefined, 'meta', new Payload()))
  })

  test('password columns encrypt, decrypt, and stay out of the payload', async ({ assert }) => {
    const definition = columnOf(User, 'secret')
    assert.equal(definition.meta?.type, 'password')
    assert.isNull(definition.serializeAs)
    assert.isNull(definition.prepare!(null, 'secret', new User()))
    assert.isNull(definition.prepare!('', 'secret', new User()))
    assert.isNull(definition.consume!(null, 'secret', new User()))
    assert.isNull(definition.consume!('', 'secret', new User()))

    const encrypted = definition.prepare!('s3cret', 'secret', new User()) as string
    assert.notEqual(encrypted, 's3cret')
    assert.equal(definition.consume!(encrypted, 'secret', new User()), 's3cret')

    const user = await User.store({ name: 'Ada', secret: 's3cret' })
    assert.notProperty(user.serialize(), 'secret')
    const stored = await User.fetch(user.id)
    assert.equal(stored.secret, 's3cret')

    const exposed = columnOf(Credential, 'secret')
    assert.equal(exposed.serializeAs, 'secret')
    assert.equal(exposed.meta?.type, 'password')
  })

  test('datetime columns prepare, consume, and serialize', ({ assert }) => {
    const open = columnOf(Post, 'publishedAt')
    const formatted = columnOf(Stamp, 'createdAt')
    const model = new Post()
    const stamp = new Stamp()
    const value = DateTime.fromISO('2024-05-06T07:08:09.000Z', { setZone: true })

    assert.equal(open.meta?.type, 'datetime')
    assert.isFalse(open.meta?.autoCreate)
    assert.isFalse(open.meta?.autoUpdate)
    assert.isTrue(formatted.meta?.autoCreate)
    assert.isFalse(formatted.meta?.autoUpdate)
    assert.equal(formatted.meta?.format, 'yyyy-LL-dd')

    assert.equal(open.prepare!(null, 'publishedAt', model), null)
    assert.equal(open.prepare!('2024-05-06', 'publishedAt', model), '2024-05-06')
    const prepared = open.prepare!(value, 'publishedAt', model) as string
    assert.include(prepared, '2024-05-06')
    assert.equal(formatted.prepare!(value, 'createdAt', stamp), '2024-05-06')

    const invalid = DateTime.fromISO('not-a-date')
    assert.throws(() => open.prepare!(invalid, 'publishedAt', model), /Post\.publishedAt/)
    assert.throws(() => open.prepare!(42, 'publishedAt', model), /luxon\.DateTime/)

    assert.isNull(open.consume!(null, 'publishedAt', model))
    const fromSql = open.consume!(prepared, 'publishedAt', model) as DateTime
    assert.isTrue(DateTime.isDateTime(fromSql))
    assert.isTrue(fromSql.isValid)
    const fromIso = open.consume!('2024-05-06T07:08:09.000Z', 'publishedAt', model) as DateTime
    assert.equal(fromIso.toUTC().toFormat('yyyy-LL-dd HH:mm:ss'), '2024-05-06 07:08:09')
    const fromDate = open.consume!(
      new Date('2024-05-06T07:08:09.000Z'),
      'publishedAt',
      model
    ) as DateTime
    assert.isTrue(DateTime.isDateTime(fromDate))
    assert.equal(
      (formatted.consume!('2024-05-06', 'createdAt', stamp) as DateTime).toFormat('yyyy-LL-dd'),
      '2024-05-06'
    )
    assert.throws(() => open.consume!(42, 'publishedAt', model), /number cannot be formatted/)

    assert.equal(open.serialize!(value, 'publishedAt', model), value.toISO())
    assert.equal(open.serialize!('raw', 'publishedAt', model), 'raw')
    assert.equal(formatted.serialize!(value, 'createdAt', stamp), '2024-05-06')

    withHeaders({ 'Date-Format': 'yyyy/LL/dd HH:mm:ss', 'Time-Zone': 'utc' }, () => {
      assert.equal(open.serialize!(value, 'publishedAt', model), '2024/05/06 07:08:09')
      assert.equal(formatted.serialize!(value, 'createdAt', stamp), '2024/05/06 07:08:09')
    })
    withHeaders({}, () => {
      assert.equal(open.serialize!(value, 'publishedAt', model), '06/05/2024 07:08:09')
    })
    withHeaders({ 'App-Name': 'mobile' }, () => {
      assert.equal(open.serialize!(value, 'publishedAt', model), value.toISO())
      assert.equal(formatted.serialize!(value, 'createdAt', stamp), '2024-05-06')
    })
    withHeaders({ 'App-Name': 'mobile', 'Date-Format': 'yyyy' }, () => {
      assert.equal(open.serialize!(value, 'publishedAt', model), '2024')
    })
  })
})
