import type { ColumnDecorator, LucidModel } from '@adonisjs/lucid/types/model'

const prepare = (value: any | null | undefined) => {
  if (value === null || value === undefined) {
    return value
  }
  return JSON.stringify(value)
}

const consume = (value: string | null | undefined) => {
  if (value === null || value === undefined) {
    return value
  }
  try {
    return JSON.parse(value)
  } catch (error) {
    return value
  }
}

const json: ColumnDecorator = (options?) => {
  return function decorateAsColumn(target, property) {
    const Model = target.constructor as LucidModel
    Model.boot()
    const normalizedOptions = Object.assign(
      {
        prepare: prepare,
        consume: consume,
        meta: {},
      },
      options
    )

    normalizedOptions.meta.type = 'json'
    Model.$addColumn(property, normalizedOptions)
  }
}

export default json
