import {
  NormalizedCache,
  Cache,
  QueryCache,
  QueryCacheValue
} from './storeUtils';

import {
  omit
} from 'lodash';

import {
  isEqual
} from '../util/isEqual';

import {
  cloneDeep
} from '../util/cloneDeep';

export function invalidateQueryCache({
  store,
  queryCache,
  updatedKeys,
  omitQueryIds,
}: {
  store: NormalizedCache,
  queryCache: QueryCache,
  updatedKeys: {[id: string]: any} | null,
  omitQueryIds?: string[],
}): Cache {
  const updatedQueryIds = Object.keys(queryCache).filter(
    queryId => (!omitQueryIds || omitQueryIds.indexOf(queryId) < 0) && (!updatedKeys || Object.keys(queryCache[queryId].pointers).some(id => !!updatedKeys[id]))
  );

  if (!updatedQueryIds.length) {
    return {
      data: store,
      queryCache
    };
  }

  console.log('MARKING QUERIES DIRTY IN CACHE', JSON.stringify(updatedQueryIds));

  const newQueryCache = {...queryCache};
  updatedQueryIds.forEach(queryId => {
    newQueryCache[queryId].dirty = true;
  });

  return {
    data: store,
    queryCache: newQueryCache,
  }
}

export function removeQueryFromCache({
  queryId,
  store,
  queryCache,
}: {
  queryId: string,
  store: NormalizedCache,
  queryCache: QueryCache,
}): Cache {
  return {
    data: store,
    queryCache: {
      ...omit(queryCache, queryId)
    }
  };
}

export function insertQueryToCache({
  queryId,
  result,
  variables = {},
  store,
  queryCache,
  queryCachePointers,
  updatedKeys,
  modified = false,
}: {
  queryId: string,
  result: any,
  variables?: Object,
  store: NormalizedCache,
  queryCache: QueryCache,
  queryCachePointers: {[id: string]: {}[]},
  updatedKeys?: {[id: string]: any},
  modified?: boolean,
}): Cache {
  if (Object.isFrozen(result)) {
    result = cloneDeep(result);
  }

  console.log('INSERTING QUERY CACHE INTO CACHE', queryId);

  const cache = updatedKeys && Object.keys(updatedKeys).length ? invalidateQueryCache({store, queryCache, updatedKeys, omitQueryIds: [queryId]}) : {
      data: store,
      queryCache
    };

  return {
    data: cache.data,
    queryCache: {
      ...cache.queryCache,
      [queryId]: mergeQueryCacheValue(cache.queryCache[queryId], {
        result: result,
        pointers: queryCachePointers,
        variables: variables,
        dirty: false,
        modified: modified,
      })
    }
  };
}

export function readQueryFromCache({
  queryId,
  queryCache,
  variables = {},
  allowModified = false,
}: {
  queryId: string,
  queryCache: QueryCache,
  variables?: Object,
  allowModified?: boolean,
}): {
  result: any,
  modified: boolean
} {
  const cachedQuery = queryCache[queryId];
  if (!cachedQuery) {
    return {
      result: null,
      modified: false,
    };
  }

  const result = !cachedQuery.dirty && (allowModified || !cachedQuery.modified) && isEqual(variables, cachedQuery.variables) ? cachedQuery.result : null;

  return {
    result: result,
    modified: cachedQuery.modified,
  }
}

function mergeQueryCacheValue(oldQueryCacheValue: QueryCacheValue, newQueryCacheValue: QueryCacheValue): QueryCacheValue {
  if (!oldQueryCacheValue) {
    return newQueryCacheValue;
  }

  newQueryCacheValue.result = mergeObject(newQueryCacheValue.result, oldQueryCacheValue.result);

  return newQueryCacheValue;
}

function mergeObject(target: any, source: any): any {
  if (target === source) {
    return source;
  }

  if (target != null && typeof target === 'object' && source != null && typeof source === 'object') {
    let differingKey = false;
    for (const key in target) {
      if (target.hasOwnProperty(key)) {
        if (!source.hasOwnProperty(key)) {
          return target;
        }

        target[key] = mergeObject(target[key], source[key]);
        if (target[key] !== source[key]) {
          differingKey = true;
        }
      }
    }

    if (differingKey) {
      return target;
    }

    for (const key in source) {
      if (!target.hasOwnProperty(key)) {
        return target;
      }
    }

    return source;
  }

  return target;
}