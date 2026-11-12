import type { ColumnDecorator, LucidModel } from '@adonisjs/lucid/types/model'
import { HttpContext } from '@adonisjs/core/http'

const prepare = (value: unknown) => {
  return value ? 1 : 0
}

const consume = (value: unknown) => {
  return Boolean(value)
}

const serialize = (value: unknown) => {
  const context = HttpContext.get()
  if (
    context &&
    context.request &&
    (!context.request.header('App-Name') || context.request.header('Bool-Format'))
  ) {
    const boolFormat = context.request.header('Bool-Format') || 'alpha'
    switch (boolFormat) {
      case 'bool':
        return !!value
      case 'int':
        return value ? 1 : 0
      case 'alpha':
        return value ? 'Y' : 'N'
    }
  }
  return value
}

const boolean: ColumnDecorator = (options?) => {
  return function decorateAsColumn(target, property) {
    const Model = target.constructor as LucidModel
    Model.boot()
    const normalizedOptions = Object.assign(
      {
        prepare: prepare,
        consume: consume,
        serialize: serialize,
        meta: {},
      },
      options
    )

    /**
     * Type always has to be a boolean
     */
    normalizedOptions.meta.type = 'boolean'
    Model.$addColumn(property, normalizedOptions)
  }
}

export default boolean
