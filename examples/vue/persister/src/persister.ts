import type {
  QueryClient,
  QueryFunctionContext,
  QueryKey,
  QueryState,
} from '@tanstack/query-core'
import { hashKey } from '@tanstack/query-core'

export type Promisable<T> = T | PromiseLike<T>

export interface PersistedQuery {
  buster: string
  timestamp: number
  queryHash: string
  queryKey: QueryKey
  state: QueryState
}

export type PersistRetryer = (props: {
  persistedQuery: PersistedQuery
  error: Error
  errorCount: number
}) => Promisable<PersistedQuery | undefined>

export interface AsyncStorage {
  getItem: (key: string) => Promise<string | undefined | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

export interface StoragePersisterOptions<QC extends QueryClient> {
  /**
   * Query Client instance
   */
  queryClient: QC
  /** The storage client used for setting and retrieving items from cache.
   * For SSR pass in `undefined`.
   */
  storage: AsyncStorage | Storage | undefined | null
  /**
   * How to serialize the data to storage.
   * @default `JSON.stringify`
   */
  serialize?: (client: PersistedQuery) => string
  /**
   * How to deserialize the data from storage.
   * @default `JSON.parse`
   */
  deserialize?: (cachedString: string) => PersistedQuery
  /**
   * A unique string that can be used to forcefully invalidate existing caches,
   * if they do not share the same buster string
   */
  buster?: string
  /**
   * The max-allowed age of the cache in milliseconds.
   * If a persisted cache is found that is older than this
   * time, it will be discarded
   */
  maxAge?: number
}

export function createPersister<T, QC extends QueryClient>(
  {
    queryClient,
    storage,
    buster = '',
    maxAge = 1000 * 60 * 60 * 24,
    serialize = JSON.stringify,
    deserialize = JSON.parse,
  }: StoragePersisterOptions<QC>,
) {
  return async (queryFn: (context: QueryFunctionContext) => T | Promise<T>, context: QueryFunctionContext) => {
    const queryHash = hashKey(context.queryKey)
    const queryState = queryClient.getQueryState(context.queryKey)

    if (!queryState?.data && storage != null) {
      const storedData = await storage.getItem(queryHash)
      if (storedData) {
        const persistedQuery = deserialize(storedData) as PersistedQuery

        if (persistedQuery.timestamp) {
          const expired = Date.now() - persistedQuery.timestamp > maxAge
          const busted = persistedQuery.buster !== buster
          if (expired || busted) {
            await storage.removeItem(queryHash)
          } else {
            queryClient.getQueryCache().build(
              queryClient,
              {
                queryKey: context.queryKey,
                queryHash: queryHash,
              },
              persistedQuery.state,
            )
            return Promise.resolve(persistedQuery.state.data as T)
          }
        } else {
          await storage.removeItem(queryHash)
        }
      }
    }

    const queryFnResult = await queryFn(context)

    if (storage != null) {
      storage.setItem(
        queryHash,
        serialize({
          state: {
            data: queryFnResult,
            dataUpdateCount: 0,
            dataUpdatedAt: Date.now(),
            status: 'success',
            error: null,
            errorUpdateCount: 0,
            errorUpdatedAt: 0,
            fetchFailureCount: 0,
            fetchFailureReason: null,
            fetchMeta: null,
            fetchStatus: 'idle',
            isInvalidated: false,
          },
          queryKey: context.queryKey,
          queryHash: queryHash,
          timestamp: Date.now(),
          buster: buster,
        }),
      )
    }

    return Promise.resolve(queryFnResult)
  }
}