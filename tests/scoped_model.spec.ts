import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import type { QueryParams } from '../src/types/types.ts'
import { getDb } from './helpers/app.ts'
import { Comment, Post, Profile, User, compiled, resetDatabase } from './helpers/models.ts'

test.group('withScopedModel', (group) => {
  group.each.setup(async () => {
    await resetDatabase()
  })

  test('applies object defaults and lets explicit values win', ({ assert }) => {
    User.defaultValues = { role: 'member', name: 'Default', active: true }
    const input = { name: 'Ada', email: null, extra: 'drop-me' }
    const result = User.applyDefaultValues(input)

    assert.deepEqual(input, { name: 'Ada', email: null, extra: 'drop-me' })
    assert.deepEqual(result, { role: 'member', name: 'Ada', active: true, extra: 'drop-me' })
    result.role = 'changed'
    const defaults = User.defaultValues
    assert.isObject(defaults)
    if (typeof defaults !== 'function') {
      assert.equal(defaults.role, 'member')
    }
  })

  test('drops null input so the default survives and keeps undefined', ({ assert }) => {
    User.defaultValues = { role: 'member', name: 'Default' }
    const result = User.applyDefaultValues({ name: null, role: undefined })

    assert.equal(result.name, 'Default')
    assert.isUndefined(result.role)
  })

  test('evaluates function defaults on every call', ({ assert }) => {
    let calls = 0
    User.defaultValues = () => {
      calls++
      return { role: `role-${calls}` }
    }

    assert.equal(User.applyDefaultValues({}).role, 'role-1')
    assert.equal(User.applyDefaultValues({ name: 'Ada' }).role, 'role-2')
    assert.equal(calls, 2)
  })

  test('keeps real columns, including nulls, and drops unknown keys', ({ assert }) => {
    const payload: Record<string, unknown> = {
      name: 'Ada',
      email: null,
      missing: 'nope',
    }
    const filtered = User.filterColumns(payload as Partial<User>)

    assert.deepEqual(filtered, { name: 'Ada', email: null })
  })

  test('keeps only computed keys', ({ assert }) => {
    const filtered = User.filterComputed({
      label: 'VIP',
      name: 'Ada',
    })

    assert.deepEqual(filtered, { label: 'VIP' })
  })

  test('stores defaults, columns, and computed values, and ignores unknown keys', async ({
    assert,
  }) => {
    let calls = 0
    User.defaultValues = () => {
      calls++
      return { role: `role-${calls}`, active: true }
    }

    const created = await User.store({
      name: 'Ada',
      email: null,
      secret: 's3cret',
      meta: { plan: 'pro' },
      label: 'VIP',
      missing: true,
    } as Partial<User>)

    assert.equal(created.name, 'Ada')
    assert.equal(created.role, 'role-1')
    assert.isTrue(created.active)
    assert.isUndefined(created.email)
    assert.equal(created.secret, 's3cret')
    assert.deepEqual(created.meta, { plan: 'pro' })
    assert.equal(created.label, 'VIP')
    assert.notProperty(created, 'missing')
    assert.notProperty(created.serialize(), 'secret')
    assert.equal(calls, 1)

    const fresh = await User.fetch(created.id)
    assert.equal(fresh.name, 'Ada')
    assert.equal(fresh.role, 'role-1')
    assert.isTrue(fresh.active)
    assert.isNull(fresh.email)
    assert.equal(fresh.secret, 's3cret')
    assert.deepEqual(fresh.meta, { plan: 'pro' })
    assert.isUndefined(fresh.label)
    assert.isTrue(DateTime.isDateTime(fresh.createdAt))
    assert.isTrue(DateTime.isDateTime(fresh.updatedAt))
  })

  test('explicit store values override defaults', async ({ assert }) => {
    const created = await User.store({
      name: 'Ada',
      role: 'admin',
      active: false,
    })

    assert.equal(created.role, 'admin')
    assert.isFalse(created.active)
  })

  test('merges columns and computed values on update', async ({ assert }) => {
    const created = await User.store({ name: 'Ada', email: 'ada@example.com', secret: 'old' })
    const updated = await created.update({
      name: 'Ada Lovelace',
      email: null,
      secret: 'new',
      label: 'VIP',
      missing: true,
    } as Partial<User>)

    assert.equal(updated.id, created.id)
    assert.equal(updated.name, 'Ada Lovelace')
    assert.isNull(updated.email)
    assert.equal(updated.secret, 'new')
    assert.equal(updated.label, 'VIP')
    assert.equal(updated.role, 'member')
    assert.notProperty(updated, 'missing')

    const fresh = await User.fetch(created.id)
    assert.equal(fresh.name, 'Ada Lovelace')
    assert.isNull(fresh.email)
    assert.equal(fresh.secret, 'new')
    assert.isUndefined(fresh.label)
  })

  test('deletes the row', async ({ assert }) => {
    const created = await User.store({ name: 'Ada' })
    await created.destroy()

    assert.isTrue(created.$isDeleted)
    await assert.rejects(() => User.fetch(created.id), /Row not found/)
  })

  test('rolls back store, update, and destroy with the given transaction', async ({ assert }) => {
    const db = getDb()
    const existing = await User.store({ name: 'Kept' })

    const storeTrx = await db.transaction()
    const pending = await User.store({ name: 'Pending' }, storeTrx)
    const visible = await User.fetch(pending.id, {}, storeTrx)
    assert.equal(visible.name, 'Pending')
    await storeTrx.rollback()
    await assert.rejects(() => User.fetch(pending.id), /Row not found/)

    const updateTrx = await db.transaction()
    await existing.update({ name: 'Changed' }, updateTrx)
    const changed = await User.fetch(existing.id, {}, updateTrx)
    assert.equal(changed.name, 'Changed')
    await updateTrx.rollback()
    const kept = await User.fetch(existing.id)
    assert.equal(kept.name, 'Kept')

    const destroyTrx = await db.transaction()
    await existing.destroy(destroyTrx)
    await assert.rejects(() => User.fetch(existing.id, {}, destroyTrx), /Row not found/)
    await destroyTrx.rollback()
    const restored = await User.fetch(existing.id)
    assert.equal(restored.name, 'Kept')
  })

  test('commits store and update performed inside a transaction', async ({ assert }) => {
    const db = getDb()
    const trx = await db.transaction()
    const created = await User.store({ name: 'Committed' }, trx)
    await created.update({ email: 'ok@example.com' }, trx)
    await trx.commit()

    const fresh = await User.fetch(created.id)
    assert.equal(fresh.name, 'Committed')
    assert.equal(fresh.email, 'ok@example.com')
  })

  test('builds the base query from filters, includes, counts, and pojo flags', async ({
    assert,
  }) => {
    const alice = await User.store({ name: 'Alice', email: 'alice@example.com' })
    const bob = await User.store({ name: 'Bob' })
    const post = await alice.related('posts').create({ title: 'Hello', body: 'World' })
    await post.related('comments').create({ body: 'Nice' })
    await alice.related('profile').create({ bio: 'Bio' })

    const filtered = User.modelQuery({
      filters: [['name', '=', 'Alice']],
      sort: { name: 'desc' },
    })
    const compiledQuery = compiled(filtered)
    assert.include(compiledQuery.sql, 'users.name')
    assert.notInclude(compiledQuery.sql.toLowerCase(), 'order by')
    assert.deepEqual(compiledQuery.bindings, ['Alice'])

    const rows = await User.modelQuery({
      filters: [
        {
          or: [
            ['name', '=', 'Alice'],
            ['name', '=', 'Bob'],
          ],
        },
      ],
      include: ['posts.comments', 'profile'],
      withCount: ['posts'],
    })
    assert.lengthOf(rows, 2)
    const loaded = rows.find((row) => row.name === 'Alice')!
    assert.lengthOf(loaded.posts, 1)
    assert.equal(loaded.posts[0].title, 'Hello')
    assert.lengthOf(loaded.posts[0].comments, 1)
    assert.equal(loaded.profile.bio, 'Bio')
    assert.equal(Number(loaded.$extras.posts_count), 1)
    assert.equal(Number(rows.find((row) => row.id === bob.id)!.$extras.posts_count), 0)

    const trx = await getDb().transaction()
    try {
      const query = User.modelQuery({}, trx)
      assert.isTrue(query.client.isTransaction)
    } finally {
      await trx.rollback()
    }
  })

  test('returns plain objects when pojo is truthy and models otherwise', async ({ assert }) => {
    await User.store({ name: 'Ada' })

    const plain = await User.modelQuery({ pojo: true })
    assert.isFalse(plain[0] instanceof User)
    assert.equal(plain[0].name, 'Ada')

    const fromString = await User.modelQuery({ pojo: '1' } as unknown as QueryParams)
    assert.isFalse(fromString[0] instanceof User)

    const models = await User.modelQuery({ pojo: '0' } as unknown as QueryParams)
    assert.instanceOf(models[0], User)

    const numericString = await User.modelQuery({ pojo: 'true' } as unknown as QueryParams)
    assert.instanceOf(numericString[0], User)

    const empty = await User.modelQuery({ pojo: '' } as unknown as QueryParams)
    assert.instanceOf(empty[0], User)

    const flagged = await User.modelQuery({ pojo: false })
    assert.instanceOf(flagged[0], User)
  })

  test('fetches by primary key and can still filter the row out', async ({ assert }) => {
    const created = await User.store({ name: 'Ada', role: 'admin' })
    const fresh = await User.fetch(created.id, {
      include: ['profile'],
    })

    assert.instanceOf(fresh, User)
    assert.equal(fresh.id, created.id)
    assert.isNull(fresh.profile)

    await assert.rejects(
      () => User.fetch(created.id, { filters: [['role', '=', 'member']] }),
      /Row not found/
    )
    await assert.rejects(() => User.fetch(9999), /Row not found/)
    await assert.rejects(() => User.fetch('9999'), /Row not found/)
  })

  test('find returns the first row after sorting', async ({ assert }) => {
    await User.store({ name: 'Cara' })
    await User.store({ name: 'Alice' })
    await User.store({ name: 'Bob' })

    const first = await User.find({
      sort: { name: 'asc' },
      filters: [['role', '=', 'member']],
    })
    assert.instanceOf(first, User)
    assert.equal(first.name, 'Alice')

    const plain = await User.find({ pojo: true, sort: { name: 'desc' } })
    assert.isFalse(plain instanceof User)
    assert.equal(plain.name, 'Cara')

    await assert.rejects(() => User.find({ filters: [['name', '=', 'Missing']] }), /Row not found/)
  })

  test('paginates with the default page size and an explicit sort', async ({ assert }) => {
    for (let index = 0; index < 21; index++) {
      await User.store({ name: `User ${String(index).padStart(2, '0')}` })
    }

    const firstPage = await User.index()
    assert.equal(firstPage.currentPage, 1)
    assert.equal(firstPage.perPage, 20)
    assert.equal(firstPage.total, 21)
    assert.lengthOf(firstPage.all(), 20)
    assert.isTrue(firstPage.hasMorePages)
    assert.instanceOf(firstPage.all()[0], User)

    const secondPage = await User.index({
      page: 2,
      perPage: 10,
      sort: { name: 'desc' },
    })
    assert.equal(secondPage.currentPage, 2)
    assert.equal(secondPage.perPage, 10)
    assert.equal(secondPage.total, 21)
    assert.lengthOf(secondPage.all(), 10)
    assert.equal(secondPage.all()[0].name, 'User 10')

    const plain = await User.index({
      pojo: '2',
      perPage: 5,
      sort: { name: 'asc' },
    } as unknown as QueryParams)
    assert.isFalse(plain.all()[0] instanceof User)
    assert.equal(plain.all()[0].name, 'User 00')
  })

  test('indexes grouped rows and preloaded relations', async ({ assert }) => {
    const alice = await User.store({ name: 'Alice', role: 'member' })
    await User.store({ name: 'Bob', role: 'admin' })
    await User.store({ name: 'Cara', role: 'member' })
    await alice.related('posts').create({ title: 'Hello', body: 'World' })

    const grouped = await User.index({
      group: ['role'],
      sort: { role: 'asc' },
      perPage: 10,
    })
    assert.equal(grouped.total, 2)
    const counts = grouped.all().map((row) => Number(row.$extras.count))
    assert.deepEqual(counts.sort(), [1, 2])

    const included = await User.index({
      include: [{ n: 'posts', f: 'title,body' }],
      filters: [['name', '=', 'Alice']],
      withCount: '["posts"]',
    } as unknown as QueryParams)
    assert.lengthOf(included.all(), 1)
    assert.equal(included.all()[0].posts[0].title, 'Hello')
    assert.equal(included.all()[0].posts[0].body, 'World')
    assert.equal(Number(included.all()[0].$extras.posts_count), 1)
  })

  test('round-trips a custom datetime column through the mixin', async ({ assert }) => {
    const user = await User.store({ name: 'Ada' })
    const publishedAt = DateTime.fromISO('2024-05-06T07:08:09.000Z')
    const post = await user.related('posts').create({
      title: 'Dated',
      publishedAt,
    })

    const fresh = await Post.find(post.id)
    assert.isNotNull(fresh)
    assert.equal(fresh!.publishedAt!.toUTC().toFormat('yyyy-LL-dd HH:mm:ss'), '2024-05-06 07:08:09')
    assert.equal(fresh!.serialize().published_at, fresh!.publishedAt!.toISO())
  })

  test('selects nested relation keys when an include restricts columns', async ({ assert }) => {
    const alice = await User.store({ name: 'Alice' })
    const post = await alice.related('posts').create({ title: 'Hello', body: 'World' })
    await post.related('comments').create({ body: 'Nice' })
    await alice.related('profile').create({ bio: 'Bio' })

    const user = await User.fetch(alice.id, {
      include: [
        { n: 'auditedPosts', f: ['title', ''] },
        { n: 'posts', f: ['title'], r: { n: 'user', f: 'name' } },
        'profile',
      ],
    })

    const audited = user.auditedPosts[0]
    assert.equal(audited.title, 'Hello')
    assert.isUndefined(audited.body)
    assert.equal(audited.id, post.id)
    assert.lengthOf(audited.comments, 1)
    assert.equal(audited.comments[0].body, 'Nice')

    const nested = user.posts[0]
    assert.equal(nested.title, 'Hello')
    assert.isUndefined(nested.body)
    assert.equal(nested.userId, alice.id)
    assert.equal(nested.user.name, 'Alice')
    assert.equal(user.profile.bio, 'Bio')
    assert.instanceOf(user.profile, Profile)
    assert.instanceOf(audited.comments[0], Comment)
  })
})
