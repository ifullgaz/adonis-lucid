import type { ColumnDecorator, LucidModel } from '@adonisjs/lucid/types/model'
import encryption from '@adonisjs/core/services/encryption'

const prepare = (value: string | null) => {
  if (!value) {
    return null
  }
  return encryption.encrypt(value)
}

const consume = (value: string | null) => {
  if (!value) {
    return null
  }
  return encryption.decrypt(value)
}

const password: ColumnDecorator = (options?) => {
  return function decorateAsColumn(target, property) {
    const Model = target.constructor as LucidModel
    Model.boot()
    const normalizedOptions = Object.assign(
      {
        prepare: prepare,
        consume: consume,
        serializeAs: null,
        meta: {},
      },
      options
    )

    normalizedOptions.meta.type = 'password'
    Model.$addColumn(property, normalizedOptions)
  }
}

export default password
