import { test } from '@japa/runner'
import type Configure from '@adonisjs/core/commands/configure'
import { configure, stubsRoot } from '../index.ts'

test.group('package entry', () => {
  test('registers the scopes preload during configure', async ({ assert }) => {
    let preloaded = ''
    const command = {
      async createCodemods() {
        return {
          async updateRcFile(callback: (rcFile: { addPreloadFile(path: string): void }) => void) {
            callback({
              addPreloadFile(path: string) {
                preloaded = path
              },
            })
          },
        }
      },
    }

    await configure(command as unknown as Configure)
    assert.equal(preloaded, '@ifullgaz/adonis-base/scopes')
  })

  test('exposes the stubs directory', ({ assert }) => {
    assert.isTrue(stubsRoot.endsWith('stubs'))
  })
})
