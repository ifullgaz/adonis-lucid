/*
 * Adapted from @adonisjs/lucid
 *
 * (c) Harminder Virk <virk@adonisjs.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
import type { LucidRow, LucidModel, DateTimeColumnDecorator } from '@adonisjs/lucid/types/model'
import { errors } from '@adonisjs/lucid'
import { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'

/**
 * The method to prepare the datetime column before persisting it's
 * value to the database
 */
const prepareDateTimeColumn = (format: string | undefined) => {
  return (value: any, attributeName: string, modelInstance: LucidRow) => {
    /**
     * Return string or missing values as it is. If `auto` is set to true on
     * the column, then the hook will always initialize the date
     */
    if (typeof value === 'string' || !value) {
      return value
    }

    const model = modelInstance.constructor as LucidModel
    const modelName = model.name

    /**
     * Format luxon instances to SQL formatted date
     */
    if (DateTime.isDateTime(value)) {
      if (!value.isValid) {
        throw new errors.E_INVALID_DATE_COLUMN_VALUE([
          `${modelName}.${attributeName}`,
          value.invalidReason,
        ])
      }

      const dateTimeFormat =
        format || model.query(modelInstance.$options).client.dialect.dateTimeFormat
      return value.toFormat(dateTimeFormat)
    }

    /**
     * Anything else if not an acceptable value for date column
     */
    throw new errors.E_INVALID_DATE_COLUMN_VALUE([
      `${modelName}.${attributeName}`,
      'It must be an instance of "luxon.DateTime"',
    ])
  }
}
/**
 * Consume database return value and convert it to an instance of luxon.DateTime
 */
const consumeDateTimeColumn = (format: string | undefined) => {
  return (value: any, attributeName: string, modelInstance: LucidRow) => {
    /**
     * Bypass null columns
     */
    if (!value) {
      return value
    }

    /**
     * Convert from string
     */
    if (typeof value === 'string') {
      const parsed = format ? DateTime.fromFormat(value, format) : DateTime.fromSQL(value)
      if (parsed.isValid) {
        return parsed
      }
      return DateTime.fromISO(value)
    }

    /**
     * Convert from date
     */
    if (value instanceof Date) {
      return DateTime.fromJSDate(value)
    }

    /**
     * Any another value cannot be formatted
     */
    const modelName = modelInstance.constructor.name
    throw new errors.E_INVALID_DATE_COLUMN_VALUE([
      `${modelName}.${attributeName}`,
      `${typeof value} cannot be formatted`,
    ])
  }
}

const serialize = (format: string | undefined) => {
  return (value: unknown) => {
    if (DateTime.isDateTime(value)) {
      const context = HttpContext.get()
      if (
        context &&
        context.request &&
        (!(context.request.header('App-Name') || format) || context.request.header('Date-Format'))
      ) {
        const dateFormat = context.request.header('Date-Format') || 'dd/MM/yyyy HH:mm:ss'
        const timezone = context.request.header('Time-Zone')
        if (timezone) {
          value = value.setZone(timezone)
        }
        return (value as DateTime).toFormat(dateFormat)
      } else if (format) {
        return (value as DateTime).toFormat(format)
      }
      return value.toISO()
    }
    return value
  }
}

/**
 * Decorator to define a new date time column
 */
const dateTime: DateTimeColumnDecorator = (options?) => {
  return function decorateAsColumn(target, property) {
    const Model = target.constructor as LucidModel
    Model.boot()

    const meta = options?.meta || {}
    const format = meta.format || undefined
    const normalizedOptions = Object.assign(
      {
        prepare: prepareDateTimeColumn(format),
        consume: consumeDateTimeColumn(format),
        serialize: serialize(format),
        meta: {},
      },
      options
    )

    /**
     * Type always has to be a datetime
     */
    normalizedOptions.meta.type = 'datetime'
    normalizedOptions.meta.autoCreate = normalizedOptions.autoCreate === true
    normalizedOptions.meta.autoUpdate = normalizedOptions.autoUpdate === true
    Model.$addColumn(property, normalizedOptions)
  }
}

export default dateTime
