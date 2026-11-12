import { test } from '@japa/runner'
import { CreatedOnly, Label, Post, User, compiled, resetDatabase } from './helpers/models.ts'

async function assertInvalidJson(
  assert: {
    equal(actual: unknown, expected: unknown): void
    deepEqual(actual: unknown, expected: unknown): void
    fail(message: string): void
  },
  run: () => Promise<unknown>
) {
  try {
    await run()
    assert.fail('Expected invalid JSON to be rejected')
  } catch (error) {
    const exception = error as { status?: number; code?: string; body?: unknown }
    assert.equal(exception.status, 422)
    assert.equal(exception.code, 'E_HTTP_EXCEPTION')
    assert.deepEqual(exception.body, { errors: ['Invalid format'] })
  }
}

async function seed() {
  const alice = await User.store({ name: 'Alice', email: 'alice@example.com', role: 'member' })
  const bob = await User.store({ name: 'Bob', email: null, role: 'admin' })
  const cara = await User.store({
    name: 'Cara 100%_done',
    email: 'cara@example.com',
    role: 'member',
  })
  const post = await alice.related('posts').create({ title: 'Hello', body: 'World' })
  await post.related('comments').create({ body: 'Nice' })
  await bob.related('posts').create({ title: 'Draft', body: null })
  await alice.related('profile').create({ bio: 'Bio' })
  return { alice, bob, cara, post }
}

test.group('query scopes', (group) => {
  group.each.setup(async () => {
    await resetDatabase()
  })

  test('applies comparison, null, list, and pattern filters', async ({ assert }) => {
    const { alice } = await seed()

    const named = await User.query().applyFilters({
      filters: [['name', '=', 'Alice']],
    })
    assert.deepEqual(
      named.map((row) => row.name),
      ['Alice']
    )

    const greater = await User.query().applyFilters({
      filters: [['id', '>', alice.id]],
    })
    assert.deepEqual(
      greater.map((row) => row.name),
      ['Bob', 'Cara 100%_done']
    )

    const listed = await User.query().applyFilters({
      filters: [['name', 'in', ['Alice', 'Bob']]],
    })
    assert.deepEqual(listed.map((row) => row.name).sort(), ['Alice', 'Bob'])

    const emptyList = await User.query().applyFilters({
      filters: [['name', 'in', []]],
    })
    assert.lengthOf(emptyList, 0)

    const missingEmail = await User.query().applyFilters({
      filters: [['email', 'null', null]],
    })
    assert.deepEqual(
      missingEmail.map((row) => row.name),
      ['Bob']
    )

    const withEmail = await User.query().applyFilters({
      filters: [['email', 'not null', null]],
    })
    assert.deepEqual(withEmail.map((row) => row.name).sort(), ['Alice', 'Cara 100%_done'])

    const prefix = await User.query().applyFilters({
      filters: [['name', 'like', 'Al']],
    })
    assert.deepEqual(
      prefix.map((row) => row.name),
      ['Alice']
    )

    const contains = await User.query().applyFilters({
      filters: [['name', 'contains', 'lic']],
    })
    assert.deepEqual(
      contains.map((row) => row.name),
      ['Alice']
    )

    const escaped = compiled(
      User.query().applyFilters({
        filters: [
          ['name', 'like', '100%_'],
          ['name', 'contains', 'a\\b'],
        ],
      })
    )
    assert.deepEqual(escaped.bindings, ['100\\%\\_%', '%a\\\\b%'])
  })

  test('filters on relations with exists, missing, has, and hasNot', async ({ assert }) => {
    await seed()

    const authors = await User.query().applyFilters({
      filters: [['posts', 'exists', null]],
    })
    assert.deepEqual(authors.map((row) => row.name).sort(), ['Alice', 'Bob'])

    const quiet = await User.query().applyFilters({
      filters: [['posts', 'missing', null]],
    })
    assert.deepEqual(
      quiet.map((row) => row.name),
      ['Cara 100%_done']
    )

    const titled = await User.query().applyFilters({
      filters: [['posts', 'has', [['title', '=', 'Hello']]]],
    })
    assert.deepEqual(
      titled.map((row) => row.name),
      ['Alice']
    )

    const withoutHello = await User.query().applyFilters({
      filters: [['posts', 'hasNot', [['title', '=', 'Hello']]]],
    })
    assert.deepEqual(withoutHello.map((row) => row.name).sort(), ['Bob', 'Cara 100%_done'])

    const existsSql = compiled(
      User.query().applyFilters({
        filters: [
          ['posts', 'exists', null],
          ['profile', 'missing', null],
        ],
      })
    )
    assert.include(existsSql.sql.toLowerCase(), 'exists')
    assert.include(existsSql.sql, 'posts')
    assert.include(existsSql.sql, 'profiles')
  })

  test('nests and and or groups and qualifies columns', async ({ assert }) => {
    await seed()

    const either = await User.query().applyFilters({
      filters: [
        {
          or: [
            ['name', '=', 'Alice'],
            {
              and: [
                ['role', '=', 'admin'],
                ['email', 'null', null],
              ],
            },
          ],
        },
      ],
    })
    assert.deepEqual(either.map((row) => row.name).sort(), ['Alice', 'Bob'])

    const sql = compiled(
      User.query().applyFilters({
        filters: [
          ['role', '=', 'member'],
          {
            or: [['name', '=', 'Alice'], { or: [['name', 'like', 'Ca']] }],
          },
        ],
      })
    )
    const normalized = sql.sql.toLowerCase()
    assert.include(normalized, 'users.role')
    assert.include(normalized, 'users.name')
    assert.include(normalized, ' or ')
    assert.include(normalized, ' and ')
    assert.deepEqual(sql.bindings, ['member', 'Alice', 'Ca%'])

    const none = await User.query().applyFilters({})
    assert.lengthOf(none, 3)
    const alsoNone = await User.query().applyFilters()
    assert.lengthOf(alsoNone, 3)
  })

  test('parses JSON filter params and rejects malformed JSON', async ({ assert }) => {
    await seed()
    const rows = await User.query().applyFilters({
      filters: JSON.stringify([['name', '=', 'Bob']]) as unknown as [],
    })
    assert.deepEqual(
      rows.map((row) => row.name),
      ['Bob']
    )

    await assertInvalidJson(assert, () => User.query().applyFilters({ filters: '{' as never }))
    await assertInvalidJson(assert, () =>
      User.query().applySort({ sort: '{' as unknown as Record<string, 'asc' | 'desc'> })
    )
    await assertInvalidJson(assert, () => User.query().applyInclude({ include: '{' as never }))
    await assertInvalidJson(assert, () => User.query().applyGroup({ group: '{' as never }))
    await assertInvalidJson(assert, () => User.query().applyWithCount({ withCount: '{' as never }))
  })

  test('or relation constraints use orWhere variants', async ({ assert }) => {
    await seed()
    const rows = await User.query().applyFilters({
      filters: [
        {
          or: [
            ['posts', 'exists', null],
            ['posts', 'has', [['title', '=', 'Missing']]],
            ['email', 'not null', null],
          ],
        },
      ],
    })
    assert.deepEqual(rows.map((row) => row.name).sort(), ['Alice', 'Bob', 'Cara 100%_done'])

    const sql = compiled(
      User.query().applyFilters({
        filters: [
          {
            or: [
              ['posts', 'missing', null],
              ['posts', 'hasNot', [['title', '=', 'Hello']]],
              ['name', 'in', ['Alice']],
              ['email', 'null', null],
            ],
          },
        ],
      })
    )
    assert.include(sql.sql.toLowerCase(), 'or ')
    assert.include(sql.sql.toLowerCase(), 'not exists')
  })

  test('sorts by model attributes and leaves unknown fields unqualified', async ({ assert }) => {
    await seed()
    const rows = await User.query().applySort({
      sort: { name: 'desc', id: 'asc' },
    })
    assert.deepEqual(
      rows.map((row) => row.name),
      ['Cara 100%_done', 'Bob', 'Alice']
    )

    const sql = compiled(
      User.query().applySort({
        sort: JSON.stringify({ createdAt: 'desc', nope: 'asc' }) as unknown as {
          createdAt: 'desc'
          nope: 'asc'
        },
      })
    )
    assert.include(sql.sql, 'users.created_at')
    assert.include(sql.sql, 'nope')
    assert.notInclude(sql.sql, 'users.nope')

    const unsorted = compiled(User.query().applySort({}))
    assert.notInclude(unsorted.sql.toLowerCase(), 'order by')
    const defaulted = compiled(User.query().applySort())
    assert.notInclude(defaulted.sql.toLowerCase(), 'order by')
  })

  test('preloads relations, nested paths, and restricted columns', async ({ assert }) => {
    const { alice, post } = await seed()

    const dotted = await User.query()
      .applyInclude({ include: ['posts.comments', 'profile'] })
      .where('id', alice.id)
      .firstOrFail()
    assert.equal(dotted.posts[0].title, 'Hello')
    assert.equal(dotted.posts[0].comments[0].body, 'Nice')
    assert.equal(dotted.profile.bio, 'Bio')

    const selected = await User.query()
      .applyInclude({
        include: JSON.stringify([
          { n: 'posts', f: 'title,', r: ['comments'] },
          { n: 'profile', f: ['bio'] },
        ]) as unknown as [],
      })
      .where('id', alice.id)
      .firstOrFail()
    assert.equal(selected.posts[0].title, 'Hello')
    assert.isUndefined(selected.posts[0].body)
    assert.equal(selected.posts[0].id, post.id)
    assert.lengthOf(selected.posts[0].comments, 1)
    assert.equal(selected.profile.bio, 'Bio')

    const unrestricted = await User.query()
      .applyInclude({ include: [{ n: 'posts', f: [''] }] })
      .where('id', alice.id)
      .firstOrFail()
    assert.equal(unrestricted.posts[0].body, 'World')

    const empty = await User.query().applyInclude({}).where('id', alice.id).firstOrFail()
    assert.notProperty(empty.$preloaded, 'posts')
    const omitted = await User.query().applyInclude().where('id', alice.id).firstOrFail()
    assert.notProperty(omitted.$preloaded, 'posts')
  })

  test('includes the parent key required by a belongsTo preload', async ({ assert }) => {
    const { alice } = await seed()
    const user = await User.query()
      .applyInclude({
        include: [{ n: 'posts', f: ['title'], r: { n: 'user', f: 'name' } }],
      })
      .where('users.id', alice.id)
      .firstOrFail()

    assert.equal(user.posts[0].title, 'Hello')
    assert.isUndefined(user.posts[0].body)
    assert.equal(user.posts[0].userId, alice.id)
    assert.equal(user.posts[0].user.name, 'Alice')
    assert.instanceOf(user.posts[0], Post)
  })

  test('adds grouping aggregates and skips them when there is nothing to group', async ({
    assert,
  }) => {
    await seed()
    const grouped = (await User.query()
      .applyGroup({ group: ['role'] })
      .pojo()) as Array<{
      role: string
      count?: number
      $extras?: { count?: number }
    }>
    assert.lengthOf(grouped, 2)
    const byRole = Object.fromEntries(
      grouped.map((row) => [row.role, Number(row.$extras?.count ?? row.count)])
    )
    assert.equal(byRole.member, 2)
    assert.equal(byRole.admin, 1)

    const sql = compiled(User.query().applyGroup({ group: ['role', 'createdAt'] }))
    assert.include(sql.sql, 'users.role')
    assert.include(sql.sql, 'users.created_at')
    assert.include(sql.sql, 'users.*')
    assert.include(sql.sql.toLowerCase(), 'max(')
    assert.include(sql.sql, 'max_created_at')
    assert.include(sql.sql, 'max_updated_at')
    assert.include(sql.sql.toLowerCase(), 'count(')

    const preselected = compiled(
      User.query()
        .select('name')
        .applyGroup({ group: ['name'] })
    )
    assert.notInclude(preselected.sql, 'users.*')
    assert.include(preselected.sql, 'users.name')

    const fromJson = compiled(
      User.query().applyGroup({
        group: JSON.stringify(['role']) as unknown as string[],
      })
    )
    assert.include(fromJson.sql, 'group by')

    const idle = compiled(User.query().applyGroup({}))
    assert.notInclude(idle.sql.toLowerCase(), 'group by')
    const defaulted = compiled(User.query().applyGroup())
    assert.notInclude(defaulted.sql.toLowerCase(), 'group by')

    const timeless = compiled(Label.query().applyGroup({ group: ['name'] }))
    assert.include(timeless.sql, 'labels.*')
    assert.notInclude(timeless.sql, 'max_created_at')
    assert.notInclude(timeless.sql, 'max_updated_at')
    assert.include(timeless.sql.toLowerCase(), 'count(')

    const created = compiled(CreatedOnly.query().applyGroup({ group: ['name'] }))
    assert.include(created.sql, 'max_created_at')
    assert.notInclude(created.sql, 'max_updated_at')
  })

  test('adds relation counts from a list or a JSON string', async ({ assert }) => {
    const { alice, cara } = await seed()
    await cara.related('posts').create({ title: 'One' })
    await cara.related('posts').create({ title: 'Two' })

    const rows = await User.query().applyWithCount({ withCount: ['posts', 'profile'] })
    const aliceRow = rows.find((row) => row.id === alice.id)!
    const caraRow = rows.find((row) => row.id === cara.id)!
    assert.equal(Number(aliceRow.$extras.posts_count), 1)
    assert.equal(Number(aliceRow.$extras.profile_count), 1)
    assert.equal(Number(caraRow.$extras.posts_count), 2)
    assert.equal(Number(caraRow.$extras.profile_count), 0)

    const fromJson = await User.query()
      .applyWithCount({
        withCount: JSON.stringify(['posts']) as unknown as string[],
      })
      .where('id', cara.id)
      .firstOrFail()
    assert.equal(Number(fromJson.$extras.posts_count), 2)

    const idle = compiled(User.query().applyWithCount({}))
    assert.notInclude(idle.sql, 'posts_count')
    const defaulted = compiled(User.query().applyWithCount())
    assert.notInclude(defaulted.sql, 'posts_count')

    await assert.rejects(
      () => User.query().applyWithCount({ withCount: ['missing'] }),
      /undefined|E_UNDEFINED_RELATIONSHIP|missing/i
    )
  })

  test('chains every scope and returns the same builder', ({ assert }) => {
    const query = User.query()
    const chained = query
      .applyFilters({ filters: [['name', '=', 'Ada']] })
      .applyInclude({ include: ['posts'] })
      .applyWithCount({ withCount: ['posts'] })
      .applySort({ sort: { name: 'asc' } })
      .applyGroup({ group: ['name'] })

    assert.equal(chained, query)
    const sql = compiled(query)
    assert.include(sql.sql, 'users.name')
    assert.include(sql.sql, 'posts_count')
    assert.include(sql.sql.toLowerCase(), 'order by')
    assert.include(sql.sql.toLowerCase(), 'group by')
  })

  test('scopes a nested has filter through the related model', async ({ assert }) => {
    await seed()
    const matched = await Post.query().applyFilters({
      filters: [['comments', 'has', [['body', 'contains', 'Nic']]]],
    })
    assert.lengthOf(matched, 1)
    assert.equal(matched[0].title, 'Hello')
  })
})
