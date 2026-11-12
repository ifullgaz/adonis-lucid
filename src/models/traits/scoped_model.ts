import { type NormalizeConstructor } from '@adonisjs/core/types/helpers'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { type BaseModel } from '@adonisjs/lucid/orm'
import type {
  ModelAdapterOptions,
  ModelAttributes,
  ModelPaginatorContract,
  ModelQueryBuilderContract,
} from '@adonisjs/lucid/types/model'
import type { QueryParams } from '../../types/types.ts'

type ModelDefaults = Partial<ModelAttributes<any>> | (() => Partial<ModelAttributes<any>>)

export function withScopedModel() {
  return <T extends NormalizeConstructor<typeof BaseModel>>(superclass: T) => {
    class ScopedModel extends superclass {
      public static defaultValues: ModelDefaults = {}

      /**
       * Automatically generates the base query for the given model type.
       */
      public static modelQuery<Self extends typeof ScopedModel>(
        this: Self,
        params: QueryParams = {},
        trx?: TransactionClientContract
      ): ModelQueryBuilderContract<Self, InstanceType<Self>> {
        const pojo = !!(typeof params.pojo === 'string'
          ? Number.parseInt(params.pojo)
          : params.pojo)
        let options: ModelAdapterOptions = {}
        if (trx) {
          options.client = trx
        }
        const query = this.query(options)
          .applyFilters(params)
          .applyInclude(params)
          .applyWithCount(params)
        if (pojo) {
          return query.pojo() as ModelQueryBuilderContract<Self, InstanceType<Self>>
        }
        return query
      }

      public static async index<Self extends typeof ScopedModel>(
        this: Self,
        params: QueryParams = {},
        trx?: TransactionClientContract
      ): Promise<ModelPaginatorContract<InstanceType<Self>>> {
        const page = params.page ?? 1
        const perPage = params.perPage ?? 20
        const query = this.modelQuery(params, trx)
        return query.applySort(params).applyGroup(params).paginate(page, perPage) as Promise<
          ModelPaginatorContract<InstanceType<Self>>
        >
      }

      public static applyDefaultValues<Self extends typeof ScopedModel>(
        this: Self,
        data: {
          [K in keyof ModelAttributes<InstanceType<Self>>]?:
            ModelAttributes<InstanceType<Self>>[K] | null
        }
      ): Partial<ModelAttributes<InstanceType<Self>>> {
        const cleanData = Object.fromEntries(
          Object.entries(data).filter(([, value]) => value !== null)
        ) as Partial<ModelAttributes<InstanceType<Self>>>
        const defaultValues =
          typeof this.defaultValues === 'function' ? this.defaultValues() : this.defaultValues
        return Object.assign({}, defaultValues, cleanData)
      }

      public static filterColumns<Self extends typeof ScopedModel>(
        this: Self,
        data: Partial<ModelAttributes<InstanceType<Self>>>
      ): Partial<ModelAttributes<InstanceType<Self>>> {
        const columnsDefinitions = this.$columnsDefinitions
        return Object.fromEntries(
          Object.entries(data).filter(([key]) => columnsDefinitions.has(key))
        ) as Partial<ModelAttributes<InstanceType<Self>>>
      }

      public static filterComputed<Self extends typeof ScopedModel>(
        this: Self,
        data: Partial<ModelAttributes<InstanceType<Self>>>
      ): Partial<ModelAttributes<InstanceType<Self>>> {
        const computedDefinitions = this.$computedDefinitions
        return Object.fromEntries(
          Object.entries(data).filter(([key]) => computedDefinitions.has(key))
        ) as Partial<ModelAttributes<InstanceType<Self>>>
      }

      public static async store<Self extends typeof ScopedModel>(
        this: Self,
        data: Partial<ModelAttributes<InstanceType<Self>>>,
        trx?: TransactionClientContract
      ): Promise<InstanceType<Self>> {
        const model = new this() as InstanceType<Self>
        const defaultedData = this.applyDefaultValues(data)
        const filteredData = this.filterColumns(defaultedData)
        model.fill(filteredData)
        const computedData = this.filterComputed(defaultedData)
        for (const [key, value] of Object.entries(computedData)) {
          ;(model as any)[key] = value
        }
        if (trx) {
          model.useTransaction(trx)
        }
        return await model.save()
      }

      public static async fetch<Self extends typeof ScopedModel>(
        this: Self,
        id: number | string,
        params: QueryParams = {},
        trx?: TransactionClientContract
      ): Promise<InstanceType<Self>> {
        return this.modelQuery(params, trx)
          .where(`${this.table}.${this.primaryKey}`, id)
          .firstOrFail()
      }

      public static async find<Self extends typeof ScopedModel>(
        this: Self,
        params: QueryParams = {},
        trx?: TransactionClientContract
      ): Promise<InstanceType<Self>> {
        return this.modelQuery(params, trx).applySort(params).firstOrFail()
      }

      public async update(
        data: Partial<ModelAttributes<this>>,
        trx?: TransactionClientContract
      ): Promise<this> {
        const Model = this.constructor as any
        const filteredData = Model.filterColumns(data)
        this.merge(filteredData)
        const computedData = Model.filterComputed(data)
        for (const [key, value] of Object.entries(computedData)) {
          ;(this as any)[key] = value
        }
        if (trx) {
          this.useTransaction(trx)
        }
        return await this.save()
      }

      public async destroy(trx?: TransactionClientContract): Promise<void> {
        if (trx) {
          this.useTransaction(trx)
        }
        return await this.delete()
      }
    }

    return ScopedModel
  }
}
