import { assert } from '@japa/assert'
import { configure, processCLIArgs, run } from '@japa/runner'
import { bootTestApp, shutdownTestApp } from '../tests/helpers/app.ts'

processCLIArgs(process.argv.splice(2))

await bootTestApp()

configure({
  files: ['tests/**/*.spec.ts'],
  plugins: [assert()],
  teardown: [
    async () => {
      await shutdownTestApp()
    },
  ],
})

run()
