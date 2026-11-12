import { User } from './helpers/models.ts'

function assertUser(user: User) {
  return user
}

/**
 * These calls are type-checked, not executed. A LucidRow result is not
 * assignable to User, so a regression that pins the mixin to the class
 * passed into compose() fails here.
 */
export async function assertScopedModelResolvesToUser() {
  assertUser(await User.store({ name: 'Ada' }))
  assertUser(await User.fetch(1))
  assertUser(await User.find())
  const page = await User.index()
  assertUser(page.all()[0])

  const queried = await User.modelQuery().first()
  if (queried) {
    assertUser(queried)
  }

  const created = await User.store({ name: 'Ada' })
  assertUser(await created.update({ name: 'Bea' }))

  const defaults: Partial<User> = User.applyDefaultValues({ name: 'Ada' })
  defaults.name satisfies string | undefined

  User.defaultValues = { name: 'Ada', role: 'member', active: true }
}
