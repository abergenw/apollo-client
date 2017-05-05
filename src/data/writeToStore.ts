
import {
  getOperationDefinition,
  getQueryDefinition,
  FragmentMap,
  getFragmentDefinitions,
  createFragmentMap,
} from '../queries/getFromAST';

import {
  storeKeyNameFromField,
  resultKeyNameFromField,
  isField,
  isInlineFragment,
  Cache,
  QueryCache,
} from './storeUtils';

import {
  OperationDefinitionNode,
  SelectionSetNode,
  FieldNode,
  DocumentNode,
  InlineFragmentNode,
  FragmentDefinitionNode,
} from 'graphql';

import {
  NormalizedCache,
  StoreObject,
  IdValue,
  isIdValue,
} from './storeUtils';

import {
  IdGetter,
} from '../core/types';

import {
  shouldInclude,
} from '../queries/directives';
import {
  invalidateQueryCache,
  insertQueryToCache
} from './queryCache';

import {isEqual} from '../util/isEqual';

/**
 * Writes the result of a query to the store.
 *
 * @param query The query document whose result we are writing to the store.
 *
 * @param result The result object returned for the query document.
 *
 * @param store The {@link NormalizedCache} used by Apollo for the `data` portion of the store.
 *
 * @param variables A map from the name of a variable to its value. These variables can be
 * referenced by the query document.
 *
 * @param dataIdFromObject A function that returns an object identifier given a particular result
 * object. See the store documentation for details and an example of this function.
 *
 * @param fragmentMap A map from the name of a fragment to its fragment definition. These fragments
 * can be referenced within the query document.
 *
 * @param queryCache
 * @param cacheQueryId
 */
let c = 0;
export function writeQueryToStore({
  result,
  query,
  store = {} as NormalizedCache,
  variables,
  dataIdFromObject,
  fragmentMap = {} as FragmentMap,
  queryCache,
  cacheQueryId,
}: {
  result: Object,
  query: DocumentNode,
  store?: NormalizedCache,
  variables?: Object,
  dataIdFromObject?: IdGetter,
  fragmentMap?: FragmentMap,
  queryCache?: QueryCache,
  cacheQueryId?: string,
}): Cache {
  const queryDefinition: OperationDefinitionNode = getQueryDefinition(query);

  const queryCachePointers = cacheQueryId ? {} : undefined;
  const updatedKeys = {};

  c = 0;
  store = writeSelectionSetToStore({
    result,
    dataId: 'ROOT_QUERY',
    selectionSet: queryDefinition.selectionSet,
    context: {
      store: store as NormalizedCache,
      variables,
      dataIdFromObject,
      fragmentMap,
      queryCachePointers,
      updatedKeys
    },
  });

  console.log('SKIPPING PROCESSED COUNT', c, store);

  if (queryCache) {
    if (cacheQueryId) {
      return insertQueryToCache({
        queryId: cacheQueryId,
        result,
        variables,
        store,
        queryCache,
        queryCachePointers: queryCachePointers as any,
        updatedKeys
      });
    }

    return invalidateQueryCache({store, queryCache, updatedKeys});
  }

  return { data: store, queryCache: {} };
}

export type WriteContext = {
  store: NormalizedCache;
  variables?: any;
  dataIdFromObject?: IdGetter;
  fragmentMap?: FragmentMap;
  queryCachePointers?: {[id: string]: {}[]};
  updatedKeys?: {[id: string]: any};
};

export function writeResultToStore({
  result,
  dataId,
  document,
  store,
  variables,
  dataIdFromObject,
  queryCache,
  cacheQueryId,
}: {
  dataId: string,
  result: any,
  document: DocumentNode,
  store?: NormalizedCache,
  variables?: Object,
  dataIdFromObject?: IdGetter,
  queryCache?: QueryCache,
  cacheQueryId?: string,
}): Cache {

  // XXX TODO REFACTOR: this is a temporary workaround until query normalization is made to work with documents.
  const selectionSet = getOperationDefinition(document).selectionSet;
  const fragmentMap = createFragmentMap(getFragmentDefinitions(document));

  const queryCachePointers = cacheQueryId ? {} : undefined;
  const updatedKeys = {};

  c = 0;
  store = writeSelectionSetToStore({
    result,
    dataId,
    selectionSet,
    context: {
      store: store as NormalizedCache,
      variables,
      dataIdFromObject,
      fragmentMap,
      queryCachePointers,
      updatedKeys,
    },
  });

  console.log('SKIPPING PROCESSED COUNT', c, store);

  if (queryCache) {
    if (cacheQueryId) {
      return insertQueryToCache({
        queryId: cacheQueryId,
        result,
        variables,
        store,
        queryCache,
        queryCachePointers: queryCachePointers as any,
        updatedKeys
      });
    }

    return invalidateQueryCache({store, queryCache, updatedKeys});
  }

  return {data: store, queryCache: {}};
}

export function writeSelectionSetToStore({
  result,
  dataId,
  processedDataIds = {},
  selectionSet,
  context,
}: {
  result: any,
  dataId: string,
  processedDataIds?: {[x: string]: FieldNode[]},
  selectionSet: SelectionSetNode,
  context: WriteContext,
}): NormalizedCache {
  const { variables, store, dataIdFromObject, fragmentMap } = context;

  selectionSet.selections.forEach((selection) => {
    const included = shouldInclude(selection, variables);

    if (isField(selection)) {
      const resultFieldKey: string = resultKeyNameFromField(selection);
      const value: any = result[resultFieldKey];

      if (value !== undefined) {
        writeFieldToStore({
          dataId,
          processedDataIds,
          value,
          field: selection,
          context,
        });
      }
    } else if (isInlineFragment(selection)) {
      if (included) {
        // XXX what to do if this tries to write the same fields? Also, type conditions...
        writeSelectionSetToStore({
          result,
          dataId,
          processedDataIds,
          selectionSet: selection.selectionSet,
          context,
        });
      }
    } else {
      // This is not a field, so it must be a fragment, either inline or named
      let fragment: InlineFragmentNode | FragmentDefinitionNode;

      if (isInlineFragment(selection)) {
        fragment = selection;
      } else {
        // Named fragment
        fragment = (fragmentMap || {})[selection.name.value];

        if (!fragment) {
          throw new Error(`No fragment named ${selection.name.value}.`);
        }
      }

      if (included) {
        writeSelectionSetToStore({
          result,
          dataId,
          processedDataIds,
          selectionSet: fragment.selectionSet,
          context,
        });
      }
    }
  });

  return store;
}


// Checks if the id given is an id that was generated by Apollo
// rather than by dataIdFromObject.
function isGeneratedId(id: string): boolean {
  return (id[0] === '$');
}

function mergeWithGenerated(generatedKey: string, realKey: string, cache: NormalizedCache) {
  const generated = cache[generatedKey];
  const real = cache[realKey];

  Object.keys(generated).forEach((key) => {
    const value = generated[key];
    const realValue = real[key];
    if (isIdValue(value)
        && isGeneratedId(value.id)
        && isIdValue(realValue)) {
      mergeWithGenerated(value.id, realValue.id, cache);
    }
    delete cache[generatedKey];
    cache[realKey] = { ...generated, ...real } as StoreObject;
  });
}

function writeFieldToStore({
  field,
  value,
  dataId,
  processedDataIds,
  context,
}: {
  field: FieldNode,
  value: any,
  dataId: string,
  processedDataIds: {[x: string]: FieldNode[]},
  context: WriteContext,
}) {
    // console.log('WRITING DATA ID AND VALUE');
    // console.log(JSON.stringify(dataId, null, 2));
  // console.log(JSON.stringify(value, null, 2));
  const { variables, dataIdFromObject, store, fragmentMap } = context;

  let storeValue: any;

  const storeFieldName: string = storeKeyNameFromField(field, variables);
  // specifies if we need to merge existing keys in the store
  let shouldMerge = false;
  // If we merge, this will be the generatedKey
  let generatedKey: string = '';

  // If this is a scalar value...
  if (!field.selectionSet || value === null) {
    storeValue =
      value != null && typeof value === 'object'
        // If the scalar value is a JSON blob, we have to "escape" it so it can’t pretend to be
        // an id.
        ? { type: 'json', json: value }
        // Otherwise, just store the scalar directly in the store.
        : value;
  } else if (Array.isArray(value)) {
    const generatedId = `${dataId}.${storeFieldName}`;

    storeValue = processArrayValue(value, generatedId, processedDataIds, field.selectionSet, context);
  } else {
    // It's an object
    let valueDataId = `${dataId}.${storeFieldName}`;
    let generated = true;

    // We only prepend the '$' if the valueDataId isn't already a generated
    // id.
    if (!isGeneratedId(valueDataId)) {
      valueDataId = '$' + valueDataId;
    }

    if (dataIdFromObject) {
      const semanticId = dataIdFromObject(value);

      // We throw an error if the first character of the id is '$. This is
      // because we use that character to designate an Apollo-generated id
      // and we use the distinction between user-desiginated and application-provided
      // ids when managing overwrites.
      if (semanticId && isGeneratedId(semanticId)) {
        throw new Error('IDs returned by dataIdFromObject cannot begin with the "$" character.');
      }

      if (semanticId) {
        valueDataId = semanticId;
        generated = false;
      }
    }

    let isProcessed = false;
    if (processedDataIds[valueDataId]) {
      if (processedDataIds[valueDataId].indexOf(field) >= 0) {
        isProcessed = true;
        // console.log('SKIPPING WRITING OF', valueDataId, processedDataIds[valueDataId].length, value);
        c++;
      }
      else {
        processedDataIds[valueDataId].push(field);
      }
    }
    else {
      processedDataIds[valueDataId] = [field];
    }

    if (!isProcessed) {
      writeSelectionSetToStore({
        result: value,
        dataId: valueDataId,
        processedDataIds,
        selectionSet: field.selectionSet,
        context,
      });
    }

    // We take the id and escape it (i.e. wrap it with an enclosing object).
    // This allows us to distinguish IDs from normal scalars.
    storeValue = {
      type: 'id',
      id: valueDataId,
      generated,
    };

    // check if there was a generated id at the location where we're
    // about to place this new id. If there was, we have to merge the
    // data from that id with the data we're about to write in the store.
    if (store[dataId] && store[dataId][storeFieldName] !== storeValue) {
      const escapedId = store[dataId][storeFieldName] as IdValue;

      // If there is already a real id in the store and the current id we
      // are dealing with is generated, we throw an error.
      if (isIdValue(storeValue) && storeValue.generated
          && isIdValue(escapedId) && !escapedId.generated) {
        throw new Error(`Store error: the application attempted to write an object with no provided id` +
            ` but the store already contains an id of ${escapedId.id} for this object.`);
      }

      if (isIdValue(escapedId) && escapedId.generated) {
        generatedKey = escapedId.id;
        shouldMerge = true;
      }
    }

    if (context.queryCachePointers) {
      if (!context.queryCachePointers[valueDataId]) {
        context.queryCachePointers[valueDataId] = [];
      }
      context.queryCachePointers[valueDataId].push(value);
    }
  }

  const newStoreObj = {
    ...store[dataId],
    [storeFieldName]: storeValue,
  } as StoreObject;

  if (shouldMerge) {
    mergeWithGenerated(generatedKey, (storeValue as IdValue).id, store);
  }

  if (!store[dataId] || store[dataId][storeFieldName] === undefined) {
    store[dataId] = newStoreObj;
  }
  else if (!isEqual(store[dataId][storeFieldName], storeValue)) {
    console.log('DIFFERING!', store[dataId][storeFieldName], storeValue);
    store[dataId] = newStoreObj;

    if (context.updatedKeys && dataId !== 'ROOT_QUERY') {
      context.updatedKeys[dataId] = true;
    }
  }
}

function processArrayValue(
  value: any[],
  generatedId: string,
  processedDataIds: {[x: string]: FieldNode[]},
  selectionSet: SelectionSetNode,
  context: WriteContext,
): any[] {
  return value.map((item: any, index: any) => {
    if (item === null) {
      return null;
    }

    let itemDataId = `${generatedId}.${index}`;

    if (Array.isArray(item)) {
      return processArrayValue(item, itemDataId, processedDataIds, selectionSet, context);
    }

    let generated = true;

    if (context.dataIdFromObject) {
      const semanticId = context.dataIdFromObject(item);

      if (semanticId) {
        itemDataId = semanticId;
        generated = false;
      }
    }

    if (context.queryCachePointers) {
      if (!context.queryCachePointers[itemDataId]) {
        context.queryCachePointers[itemDataId] = [];
      }
      context.queryCachePointers[itemDataId].push(item);
    }

    const idStoreValue: IdValue = {
      type: 'id',
      id: itemDataId,
      generated,
    };

    if (processedDataIds[itemDataId]) {
      if (processedDataIds[itemDataId].indexOf(item) >= 0) {
        // console.log('SKIPPING WRITING OF', itemDataId, processedDataIds[itemDataId].length, item);
        c++;
        return idStoreValue;
      }
      else {
        processedDataIds[itemDataId].push(item);
      }
    }
    else {
      processedDataIds[itemDataId] = [item];
    }

    writeSelectionSetToStore({
      result: item,
      dataId: itemDataId,
      processedDataIds,
      selectionSet,
      context,
    });

    return idStoreValue;
  });
}
