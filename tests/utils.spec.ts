import dns from 'node:dns/promises'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@japa/runner'
import type { HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import {
  defer,
  extractParam,
  filterColumns,
  formatSecondsToDuration,
  getCallerIp,
  getCurrentVersion,
  isJSON,
  modelColumnName,
  modelFields,
  pickModelFields,
  promiseAllWithLimit,
  qualifiedColumnName,
  randomNumericCode,
  sleep,
  truncate,
} from '../src/utils/utils.ts'
import { User, resetDatabase } from './helpers/models.js'

function requestContext(header?: string, ip?: string) {
  return {
    request: {
      header() {
        return header
      },
      ip() {
        return ip
      },
    },
  } as unknown as HttpContext
}

test.group('utils', (group) => {
  group.each.setup(async () => {
    await resetDatabase()
  })

  test('extracts params and rejects malformed JSON', ({ assert }) => {
    assert.deepEqual(extractParam({}, 'filters'), [])
    assert.deepEqual(extractParam({ filters: null }, 'filters'), [])
    assert.deepEqual(extractParam({ filters: ['name'] }, 'filters'), ['name'])
    assert.deepEqual(extractParam({ filters: '["name"]' }, 'filters'), ['name'])
    try {
      extractParam({ filters: '{' }, 'filters')
      assert.fail('Expected invalid JSON to be rejected')
    } catch (error) {
      const exception = error as { status?: number; code?: string; body?: unknown }
      assert.equal(exception.status, 422)
      assert.equal(exception.code, 'E_HTTP_EXCEPTION')
      assert.deepEqual(exception.body, { errors: ['Invalid format'] })
    }
  })

  test('logs a non-error when param JSON parsing throws', ({ assert }) => {
    const parse = JSON.parse
    const original = logger.error.bind(logger)
    let logged = ''
    JSON.parse = (() => {
      throw 'bad json'
    }) as typeof JSON.parse
    logger.error = ((message: unknown, error: unknown) => {
      logged = `${message}:${String(error)}`
    }) as typeof logger.error
    try {
      extractParam({ filters: '[]' }, 'filters')
      assert.fail('Expected invalid JSON to be rejected')
    } catch (error) {
      const exception = error as { status?: number; code?: string; body?: unknown }
      assert.equal(exception.status, 422)
      assert.equal(exception.code, 'E_HTTP_EXCEPTION')
      assert.deepEqual(exception.body, { errors: ['Invalid format'] })
      assert.equal(logged, 'Unknown error::bad json')
    } finally {
      JSON.parse = parse
      logger.error = original as typeof logger.error
    }
  })

  test('generates a numeric code of the requested width', ({ assert }) => {
    for (let index = 0; index < 50; index++) {
      assert.match(randomNumericCode(1), /^\d$/)
      assert.match(randomNumericCode(4), /^\d{4}$/)
      assert.match(randomNumericCode(8), /^\d{8}$/)
    }
  })

  test('filters a payload down to model columns', ({ assert }) => {
    const payload: Record<string, unknown> = { name: 'Ada', email: null, missing: 1 }
    assert.deepEqual(filterColumns(User, payload as Partial<User>), {
      name: 'Ada',
      email: null,
    })
  })

  test('resolves after the requested delay', async ({ assert }) => {
    const started = Date.now()
    await sleep(30)
    assert.isAtLeast(Date.now() - started, 25)
  })

  test('detects JSON-like values', ({ assert }) => {
    assert.isTrue(isJSON([]))
    assert.isTrue(isJSON({}))
    assert.isTrue(isJSON({ a: 1 }))
    assert.isTrue(isJSON(new Date()))
    assert.isTrue(
      isJSON({
        toJSON() {
          return 1
        },
      })
    )
    assert.isFalse(isJSON(Buffer.from('a')))
    assert.isFalse(isJSON(1))
    assert.isFalse(isJSON('text'))
    assert.isFalse(isJSON(new (class Box {})()))
    assert.throws(() => isJSON(null))
    assert.throws(() => isJSON(undefined))
  })

  test('truncates toward zero', ({ assert }) => {
    assert.equal(truncate(1.239), 1.23)
    assert.equal(truncate(1.2), 1.2)
    assert.equal(truncate(10.999), 10.99)
    assert.equal(truncate(-1.239), -1.23)
    assert.equal(truncate(1.239, 0), 1)
    assert.equal(truncate(1.2345, 3), 1.234)
  })

  test('formats a duration from the largest matching unit', ({ assert }) => {
    const cases: Array<[number, string]> = [
      [0, '0 seconds'],
      [1, '1 second'],
      [2, '2 seconds'],
      [59, '59 seconds'],
      [60, '1 minute'],
      [119, '1 minute'],
      [120, '2 minutes'],
      [3600, '1 hour'],
      [7200, '2 hours'],
      [86400, '1 day'],
      [172800, '2 days'],
      [2592000, '1 month'],
      [5184000, '2 months'],
      [31536000, '1 year'],
      [63072000, '2 years'],
    ]
    for (const [seconds, label] of cases) {
      assert.equal(formatSecondsToDuration(seconds), label)
    }
  })

  test('lists and picks model fields', ({ assert }) => {
    const previousCreatedAt = (User as unknown as { createdAtColumn?: string }).createdAtColumn
    const previousUpdatedAt = (User as unknown as { updatedAtColumn?: string }).updatedAtColumn
    try {
      assert.deepEqual(modelFields(User), [
        'id',
        'name',
        'email',
        'role',
        'active',
        'secret',
        'meta',
        'createdAt',
        'updatedAt',
      ])
      ;(User as unknown as { createdAtColumn?: string }).createdAtColumn = 'createdAt'
      ;(User as unknown as { updatedAtColumn?: string }).updatedAtColumn = 'updatedAt'
      assert.deepEqual(modelFields(User), [
        'id',
        'name',
        'email',
        'role',
        'active',
        'secret',
        'meta',
      ])
      assert.includeMembers(modelFields(User, { excludeTimestamps: false }), [
        'createdAt',
        'updatedAt',
      ])
      assert.notInclude(modelFields(User, { exclude: ['secret', 'meta'] }), 'secret')
      assert.notInclude(modelFields(User, { exclude: ['secret', 'meta'] }), 'meta')

      assert.deepEqual(
        pickModelFields(User, {
          name: 'Ada',
          createdAt: 'now',
          secret: 'hidden',
          extra: true,
        }),
        { name: 'Ada', secret: 'hidden' }
      )
      assert.deepEqual(
        pickModelFields(
          User,
          { name: 'Ada', createdAt: 'now' },
          { excludeTimestamps: false, exclude: ['name'] }
        ),
        { createdAt: 'now' }
      )
    } finally {
      ;(User as unknown as { createdAtColumn?: string }).createdAtColumn = previousCreatedAt
      ;(User as unknown as { updatedAtColumn?: string }).updatedAtColumn = previousUpdatedAt
    }
  })

  test('qualifies known columns and leaves unknown fields alone', ({ assert }) => {
    assert.equal(modelColumnName(User, 'createdAt'), 'created_at')
    assert.equal(modelColumnName(User, 'created_at'), 'created_at')
    assert.isNull(modelColumnName(User, 'missing'))
    assert.equal(qualifiedColumnName(User, 'name'), 'users.name')
    assert.equal(qualifiedColumnName(User, 'createdAt'), 'users.created_at')
    assert.equal(qualifiedColumnName(User, 'missing'), 'missing')
  })

  test('runs tasks with a concurrency limit and captures failures', async ({ assert }) => {
    let active = 0
    let peak = 0
    const tasks = Array.from({ length: 6 }, (_, index) => {
      return async () => {
        active++
        peak = Math.max(peak, active)
        await sleep(20)
        active--
        if (index === 2) {
          throw new Error('task failed')
        }
        if (index === 4) {
          throw 'boom'
        }
        return index
      }
    })

    const results = await promiseAllWithLimit(tasks, 2)
    assert.isAtMost(peak, 2)
    assert.deepEqual(
      results.map((result) => (result instanceof Error ? result.message : result)),
      [0, 1, 'task failed', 3, 'boom', 5]
    )

    const wide = await promiseAllWithLimit([async () => 'ok'], 10)
    assert.deepEqual(wide, ['ok'])
    const idle = await promiseAllWithLimit([async () => 'skipped'], 0)
    assert.deepEqual(idle, [undefined])
  })

  test('defers work and logs a rejected callback', async ({ assert }) => {
    let ran = false
    defer(async () => {
      ran = true
    }, 'ok')
    await sleep(20)
    assert.isTrue(ran)

    let delayed = false
    defer(
      async () => {
        delayed = true
      },
      'later',
      30
    )
    assert.isFalse(delayed)
    await sleep(50)
    assert.isTrue(delayed)

    const original = logger.error.bind(logger)
    let logged = ''
    logger.error = ((error: unknown, message?: string) => {
      logged = `${message}:${error instanceof Error ? error.message : String(error)}`
    }) as typeof logger.error
    try {
      defer(async () => {
        throw new Error('boom')
      }, 'deferred failed')
      await sleep(20)
      assert.equal(logged, 'deferred failed:boom')
    } finally {
      logger.error = original as typeof logger.error
    }
  })

  test('resolves the caller ip from the request, metadata, or the host', async ({ assert }) => {
    assert.equal(await getCallerIp(requestContext('10.0.0.8', '10.0.0.1')), '10.0.0.8')
    assert.equal(await getCallerIp(requestContext(undefined, '10.0.0.1')), '10.0.0.1')

    const directory = mkdtempSync(join(tmpdir(), 'adonis-lucid-meta-'))
    const metadataFile = join(directory, 'ecs')
    const previous = process.env.ECS_CONTAINER_METADATA_FILE
    process.env.ECS_CONTAINER_METADATA_FILE = metadataFile
    try {
      writeFileSync(metadataFile, JSON.stringify({ HostPrivateIPv4Address: '10.1.1.1' }))
      assert.equal(await getCallerIp(requestContext('', '')), '10.1.1.1')

      writeFileSync(metadataFile, JSON.stringify({}))
      const fromHost = await getCallerIp(requestContext('', ''))
      assert.match(fromHost, /.+/)

      writeFileSync(metadataFile, '{')
      const afterInvalid = await getCallerIp(requestContext('', ''))
      assert.match(afterInvalid, /.+/)
    } finally {
      if (previous === undefined) {
        delete process.env.ECS_CONTAINER_METADATA_FILE
      } else {
        process.env.ECS_CONTAINER_METADATA_FILE = previous
      }
      rmSync(directory, { recursive: true, force: true })
    }

    process.env.ECS_CONTAINER_METADATA_FILE = join(directory, 'missing')
    try {
      const address = await getCallerIp(requestContext())
      assert.match(address, /.+/)
    } finally {
      delete process.env.ECS_CONTAINER_METADATA_FILE
    }
  })

  test('falls back to loopback when the host lookup fails', async ({ assert }) => {
    const lookup = dns.lookup
    const previous = process.env.ECS_CONTAINER_METADATA_FILE
    delete process.env.ECS_CONTAINER_METADATA_FILE
    dns.lookup = (async () => {
      throw new Error('lookup failed')
    }) as typeof dns.lookup
    try {
      assert.equal(await getCallerIp(requestContext()), '127.0.0.1')
    } finally {
      dns.lookup = lookup
      if (previous === undefined) {
        delete process.env.ECS_CONTAINER_METADATA_FILE
      } else {
        process.env.ECS_CONTAINER_METADATA_FILE = previous
      }
    }
  })

  test('resolves the current version from config, the environment, or package.json', async ({
    assert,
  }) => {
    const previousConfig = app.config.get('version')
    const previousEnv = process.env.npm_package_version
    try {
      app.config.set('version', { version: '9.9.9' })
      assert.equal(await getCurrentVersion(), '9.9.9')

      app.config.set('version', null)
      process.env.npm_package_version = '1.2.3'
      assert.equal(await getCurrentVersion(), '1.2.3')

      delete process.env.npm_package_version
      const packageVersion = JSON.parse(readFileSync(app.makePath('package.json'), 'utf-8')).version
      assert.equal(await getCurrentVersion(), packageVersion)
    } finally {
      app.config.set('version', previousConfig)
      if (previousEnv === undefined) {
        delete process.env.npm_package_version
      } else {
        process.env.npm_package_version = previousEnv
      }
    }
  })
})
