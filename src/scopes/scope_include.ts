import { ModelQueryBuilder } from '@adonisjs/lucid/orm'
import type { LucidModel, LucidRow, ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { RelationshipsContract } from '@adonisjs/lucid/types/relations'
import type { Include, IncludeField, IncludeParams } from '../types/types.ts'
import { extractParam, qualifiedColumnName } from '../utils.ts'

declare module '@adonisjs/lucid/types/model' {
  interface ModelQueryBuilderContract<Model extends LucidModel, Result = InstanceType<Model>> {
    applyInclude(params?: IncludeParams): this
  }
}
declare module '@adonisjs/lucid/orm' {
  interface ModelQueryBuilder {
    applyInclude(params?: IncludeParams): this
  }
}

ModelQueryBuilder.macro(
  'applyInclude',
  function (this: ModelQueryBuilder, params: IncludeParams = {}) {
    const includes = extractParam(params, 'include') as Include
    parseIncludes(this, includes)
    return this
  }
)

type NormalizedInclude = { n: string; f: string[]; r: Include }

function parseIncludes<T extends LucidModel>(
  query: ModelQueryBuilderContract<T, LucidRow>,
  includes: Include
): void {
  for (const include of includes) {
    parseInclude(query, include)
  }
}

function normalizeInclude(field: IncludeField): NormalizedInclude {
  if (typeof field === 'string') {
    const [relation, ...subRelation] = field.split('.')
    return {
      n: relation,
      f: [],
      r: subRelation.length ? [subRelation.join('.')] : [],
    }
  }
  const fields = typeof field.f === 'string' ? field.f.split(',') : (field.f ?? [])
  const relations = Array.isArray(field.r) ? field.r : field.r ? [field.r] : []
  return {
    n: field.n,
    f: fields.filter((name) => name.length > 0),
    r: relations,
  }
}

function parseInclude<T extends LucidModel>(
  query: ModelQueryBuilderContract<T, LucidRow>,
  field: IncludeField
): void {
  const include = normalizeInclude(field)
  query.preload(include.n as any, (subQuery: any) => {
    if (include.r.length > 0) {
      parseIncludes(subQuery, include.r)
    }
    if (include.f.length > 0) {
      subQuery.select(selectedColumns(subQuery.model, include.f, subQuery.preloader.preloads))
    }
  })
}

/**
 * Qualifies the requested fields with the related table and adds the parent
 * keys of every relation preloaded from it, including the ones a relation's
 * `onQuery` hook registers. Lucid adds the keys matching the rows to their
 * parent itself (`selectRelationKeys`).
 */
function selectedColumns(
  model: LucidModel,
  fields: string[],
  preloads: Record<string, { relation: RelationshipsContract }>
): string[] {
  const keys = Object.values(preloads).map(({ relation }) => parentKey(relation))
  const columns = [...fields, ...keys].map((field) => {
    return qualifiedColumnName(model, field)
  })
  return [...new Set(columns)]
}

/** Key the parent model must expose for the relation to be preloaded. */
function parentKey(relation: RelationshipsContract): string {
  const keys = relation as any
  return relation.type === 'belongsTo' ? keys.foreignKey : keys.localKey
}
