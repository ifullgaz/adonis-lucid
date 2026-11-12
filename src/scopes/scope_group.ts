import { ModelQueryBuilder } from '@adonisjs/lucid/orm'
import { extractParam, qualifiedColumnName } from '../utils.ts'
import type { Group, GroupParams } from '../types/types.ts'

declare module '@adonisjs/lucid/types/model' {
  interface ModelQueryBuilderContract<Model extends LucidModel, Result = InstanceType<Model>> {
    applyGroup(params?: GroupParams): this
  }
}
declare module '@adonisjs/lucid/orm' {
  interface ModelQueryBuilder {
    applyGroup(params?: GroupParams): this
  }
}

ModelQueryBuilder.macro('applyGroup', function (this: ModelQueryBuilder, params: GroupParams = {}) {
  const groups = extractParam(params, 'group') as Group[]
  const tableName = this.model.table

  if (groups.length) {
    // Apply grouping
    for (const group of groups) {
      const qualifiedName = qualifiedColumnName(this.model, group)
      this.groupBy(qualifiedName)
    }
    if (!this.columns.length) {
      this.select(tableName + '.*')
    }
    const createdAt = this.model.$getColumn('createdAt')
    if (createdAt) {
      this.max(`${tableName}.${createdAt.columnName} as max_created_at`)
    }
    const updatedAt = this.model.$getColumn('updatedAt')
    if (updatedAt) {
      this.max(`${tableName}.${updatedAt.columnName} as max_updated_at`)
    }
    this.count('* as count')
  }
  return this
})
