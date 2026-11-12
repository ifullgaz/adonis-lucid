import type { LucidModel, LucidRow, ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import { ModelQueryBuilder } from '@adonisjs/lucid/orm'
import type { FilterParams, FieldFilter, Filter } from '../types/types.ts'
import { extractParam, qualifiedColumnName } from '../utils.ts'

declare module '@adonisjs/lucid/types/model' {
  interface ModelQueryBuilderContract<Model extends LucidModel, Result = InstanceType<Model>> {
    applyFilters(params?: FilterParams): this
  }
}
declare module '@adonisjs/lucid/orm' {
  interface ModelQueryBuilder {
    applyFilters(params?: FilterParams): this
  }
}

ModelQueryBuilder.macro(
  'applyFilters',
  function (this: ModelQueryBuilder, params: FilterParams = {}) {
    const filters = extractParam(params, 'filters')
    parseFilters(this, filters)
    return this
  }
)

/**
 * Type guard to check if a filter is an OR condition object.
 * @param filter - The filter to check
 * @returns True if the filter has an ':or' property
 */
function isOrFilter(filter: Filter): filter is { or: Filter[] } {
  return typeof filter === 'object' && filter !== null && 'or' in filter
}

/**
 * Type guard to check if a filter is an OR condition object.
 * @param filter - The filter to check
 * @returns True if the filter has an ':or' property
 */
function isAndFilter(filter: Filter): filter is { and: Filter[] } {
  return typeof filter === 'object' && filter !== null && 'and' in filter
}

/**
 * Parses an array of filters and applies them to the query.
 * @param query - The Lucid query builder instance
 * @param filters - Array of filters to apply
 * @param or - Whether to use OR conditions (default: false)
 */
function parseFilters<T extends LucidModel>(
  query: ModelQueryBuilderContract<T, LucidRow>,
  filters: Filter[],
  or: Boolean = false
): void {
  for (const filter of filters) {
    if (isOrFilter(filter)) {
      or
        ? query.orWhere((subQuery) => {
            parseFilters(subQuery, filter['or'], true)
          })
        : query.where((subQuery) => {
            parseFilters(subQuery, filter['or'], true)
          })
    } else if (isAndFilter(filter)) {
      or
        ? query.orWhere((subQuery) => {
            parseFilters(subQuery, filter['and'])
          })
        : query.where((subQuery) => {
            parseFilters(subQuery, filter['and'])
          })
    } else {
      applyFilterField(query, filter as [string, string, any], or)
    }
  }
}

/**
 * Escapes LIKE wildcards so `%` and `_` in the value match literally.
 * Relies on MySQL's default `\` escape character.
 */
function escapeLike(value: unknown): string {
  return String(value).replace(/[\\%_]/g, '\\$&')
}

/**
 * Applies a single filter to the query.
 * @param query - The Lucid query builder instance
 * @param filter - A single filter tuple [field, operator, value]
 * @param or - Whether to use OR condition (default: false)
 * @returns The modified query builder
 */
function applyFilterField<T extends LucidModel>(
  query: ModelQueryBuilderContract<T, LucidRow>,
  filter: FieldFilter,
  or: Boolean
): ModelQueryBuilderContract<T, LucidRow> {
  const [field, op, value] = filter as [string, string, any]
  const qualifiedName = qualifiedColumnName(query.model, field)
  switch (op) {
    case 'like':
      return or
        ? query.orWhere(qualifiedName, 'like', `${escapeLike(value)}%`)
        : query.where(qualifiedName, 'like', `${escapeLike(value)}%`)
    case 'contains':
      return or
        ? query.orWhere(qualifiedName, 'like', `%${escapeLike(value)}%`)
        : query.where(qualifiedName, 'like', `%${escapeLike(value)}%`)
    case 'in':
      return or ? query.orWhereIn(qualifiedName, value) : query.whereIn(qualifiedName, value)
    case 'exists':
      return or ? query.orHas(field as any) : query.has(field as any)
    case 'missing':
      return or ? query.orDoesntHave(field as any) : query.doesntHave(field as any)
    case 'has':
      return or
        ? query.orWhereHas(field as any, (subQuery) => {
            parseFilters(subQuery, value)
          })
        : query.whereHas(field as any, (subQuery) => {
            parseFilters(subQuery, value)
          })
    case 'hasNot':
      return or
        ? query.orWhereDoesntHave(field as any, (subQuery) => {
            parseFilters(subQuery, value)
          })
        : query.whereDoesntHave(field as any, (subQuery) => {
            parseFilters(subQuery, value)
          })
    case 'null':
      return or ? query.orWhereNull(qualifiedName) : query.whereNull(qualifiedName)
    case 'not null':
      return or ? query.orWhereNotNull(qualifiedName) : query.whereNotNull(qualifiedName)
    default:
      return or ? query.orWhere(qualifiedName, op, value) : query.where(qualifiedName, op, value)
  }
}
