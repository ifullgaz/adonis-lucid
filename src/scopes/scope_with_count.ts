import { ModelQueryBuilder } from '@adonisjs/lucid/orm'
import { extractParam } from '../utils.ts'
import type { WithCount, WithCountParams } from '../types/types.ts'

declare module '@adonisjs/lucid/types/model' {
  interface ModelQueryBuilderContract<Model extends LucidModel, Result = InstanceType<Model>> {
    applyWithCount(params?: WithCountParams): this
  }
}
declare module '@adonisjs/lucid/orm' {
  interface ModelQueryBuilder {
    applyWithCount(params?: WithCountParams): this
  }
}

ModelQueryBuilder.macro(
  'applyWithCount',
  function (this: ModelQueryBuilder, params: WithCountParams = {}) {
    const counts = extractParam(params, 'withCount') as WithCount[]
    for (const relation of counts) {
      this.withCount(relation as any)
    }
    return this
  }
)
