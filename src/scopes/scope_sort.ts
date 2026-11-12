import { ModelQueryBuilder } from '@adonisjs/lucid/orm'
import { extractParam, qualifiedColumnName } from '../utils.ts'
import type { Sort, SortParams } from '../types/types.ts'

declare module '@adonisjs/lucid/types/model' {
  interface ModelQueryBuilderContract<Model extends LucidModel, Result = InstanceType<Model>> {
    applySort(params?: SortParams): this
  }
}
declare module '@adonisjs/lucid/orm' {
  interface ModelQueryBuilder {
    applySort(params?: SortParams): this
  }
}

ModelQueryBuilder.macro('applySort', function (this: ModelQueryBuilder, params: SortParams = {}) {
  const sort = extractParam(params, 'sort') as Sort
  // Apply sorting
  for (const [fieldName, order] of Object.entries(sort)) {
    const qualifiedName = qualifiedColumnName(this.model, fieldName)
    this.orderBy(qualifiedName, order)
  }
  return this
})
