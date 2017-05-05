import {
  Cache,
} from './storeUtils';

import {
  writeResultToStore,
} from './writeToStore';

import {
  ApolloReducerConfig,
} from '../store';

import {
  DocumentNode,
} from 'graphql';

export function replaceQueryResults(cache: Cache, {
  queryId,
  variables,
  document,
  newResult,
}: {
  queryId: string,
  variables: any;
  document: DocumentNode;
  newResult: Object;
}, config: ApolloReducerConfig): Cache {
  return writeResultToStore({
    result: newResult,
    dataId: 'ROOT_QUERY',
    variables,
    document,
    store: {...cache.data},
    dataIdFromObject: config.dataIdFromObject,
    queryCache: cache.queryCache,
    cacheQueryId: queryId,
  });
}
