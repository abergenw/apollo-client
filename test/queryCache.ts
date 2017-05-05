import {assert} from 'chai';
import {HeuristicFragmentMatcher} from '../src/data/fragmentMatcher';
import mockNetworkInterface from './mocks/mockNetworkInterface';
import mockQueryManager from './mocks/mockQueryManager';
import gql from 'graphql-tag';
import ApolloClient from '../src/ApolloClient'; import {cloneDeep} from '../src/util/cloneDeep';


describe('query cache', () => {
  const query = gql`
      query account {
          node(id: "account1") {
              id
              name
              owner {
                  id
                  name
              }
              users {
                  id
                  name
              }
          }
      }
  `;

  const data = {
    node: {
      id: 'account1',
      name: 'Account 1',
      owner: {
        id: 'user1',
        name: 'User 1',
      },
      users: [
        {
          id: 'user1',
          name: 'User 1'
        },
        {
          id: 'user2',
          name: 'User 2',
        }
      ]
    },
  };

  const initialState: any = {
    apollo: {
      data: {
        'ROOT_QUERY': {
          'node({"id":"account1"})': {
            'generated': false,
            'id': 'account1',
            'type': 'id',
          },
        },
        'account1': {
          'id': 'account1',
          'name': 'Account 1',
          'owner': {
            'generated': false,
            'id': 'user1',
            'type': 'id',
          },
          'users': [
            {
              'generated': false,
              'id': 'user1',
              'type': 'id',
            },
            {
              'generated': false,
              'id': 'user2',
              'type': 'id',
            }
          ]
        },
        'user1': {
          'id': 'user1',
          'name': 'User 1',
        },
        'user2': {
          'id': 'user2',
          'name': 'User 2',
        }
      },
    },
  };

  it('is inserted when provided initial state with data for query', () => {
    const networkInterface = mockNetworkInterface();

    const client = new ApolloClient({
      networkInterface,
      initialState,
      addTypename: false,
      dataIdFromObject: (obj: any) => obj.id
    });

    return client.query({query, fetchPolicy: 'cache-only'})
      .then((result: any) => {
        assert.deepEqual(result.data, data);

        const cache = client.store.getState().apollo.cache;

        assert.deepEqual(cache, {
          data: initialState.apollo.data,
          queryCache: {
            '1': {
              dirty: false,
              result: data,
              variables: {},
              pointers: {
                'account1': [result.data.node],
                'user1': [result.data.node.owner, result.data.node.users[0]],
                'user2': [result.data.node.users[1]]
              }
            }
          }
        });

        // assert.strictEqual(cache.queryCache['1'].pointers['account1'][0], cache.queryCache['1'].result.node);
        // assert.strictEqual(cache.queryCache['1'].pointers['user1'][0], cache.queryCache['1'].result.node.owner);
        // assert.strictEqual(cache.queryCache['1'].pointers['user1'][1], cache.queryCache['1'].result.node.users[0]);
        // assert.strictEqual(cache.queryCache['1'].pointers['user2'][0], cache.queryCache['1'].result.node.users[1]);
      });
  });

  it('is inserted after requesting a query over the network', () => {
    const networkInterface = mockNetworkInterface({
      request: {query},
      result: {data},
    });

    const client = new ApolloClient({
      networkInterface,
      addTypename: false,
      dataIdFromObject: (obj: any) => obj.id
    });

    return client.query({query})
      .then((result: any) => {
        assert.deepEqual(result.data, data);

        const cache = client.store.getState().apollo.cache;

        console.log(JSON.stringify(cache.queryCache, null, 2));

        assert.deepEqual(cache, {
          data: initialState.apollo.data,
          queryCache: {
            '1': {
              dirty: false,
              result: data,
              variables: {},
              pointers: {
                'account1': [result.data.node],
                'user1': [result.data.node.owner, result.data.node.users[0]],
                'user2': [result.data.node.users[1]],
              }
            }
          }
        });

        // assert.strictEqual(cache.queryCache['1'].pointers['account1'][0], cache.queryCache['1'].result.node);
        // assert.strictEqual(cache.queryCache['1'].pointers['user1'][0], cache.queryCache['1'].result.node.owner);
        // assert.strictEqual(cache.queryCache['1'].pointers['user1'][1], cache.queryCache['1'].result.node.users[0]);
        // assert.strictEqual(cache.queryCache['1'].pointers['user2'][0], cache.queryCache['1'].result.node.users[1]);
      });
  });

  it('sitedrive is cleared and rebuilt after requesting an overlapping query over the network', done => {
    const query2 = gql`
        query account {
            node(id: "account1") {
                id
                name
                newField
                owner {
                    id
                    name
                }
                users {
                    id
                    name
                }
            }
        }
    `;

    const data2 = {
      node: {
        id: 'account1',
        name: 'Changed account 1',
        newField: 'New field',
        owner: {
          id: 'user1',
          name: 'User 1',
        },
        users: [
          {
            id: 'user1',
            name: 'User 1'
          },
          {
            id: 'user2',
            name: 'User 2',
          }
        ]
      },
    };

    const finalState = cloneDeep(initialState);
    finalState.apollo.data['account1'].newField = data2.node.newField;

    const queryManager = mockQueryManager({
      request: {query},
      result: {data},
    }, {
      request: {query: query2},
      result: {data: data2},
    });

    const observable = queryManager.watchQuery<any>({query});

    console.log('CALLED WATCH CALLING SUBSCRIBE');

    let count = 0;
    let secondQueryDone = false;
    observable.subscribe({
      next: result => {
        switch (count++) {
          case 0:
            console.log('ZERO');
            assert.deepEqual(result.data, data);
            queryManager.query({query: query2})
              .then(result => {
                console.log('ZERO DONE');
                assert.deepEqual(result.data, data2);
                count > 1 ? done() : secondQueryDone = true;
              });
            break;
          case 1:
            console.log('ONE!!!');
            assert.deepEqual(result.data, data2);
            done();
            break;
          default:
            done(new Error('`next` was called to many times.'));
        }
      },
      error: error => done(error)
    });

    //
    // const networkInterface = mockNetworkInterface({
    //   request: {query},
    //   result: {data},
    // }, {
    //   request: {query: query2},
    //   result: {data: data2},
    // });
    //
    // const client = new ApolloClient({
    //   networkInterface,
    //   addTypename: false,
    //   dataIdFromObject: (obj: any) => obj.id
    // });
    //
    // return client.query({query})
    //   .then((result: any) => {
    //     return client.query({query: query2})
    //       .then((result: any) => {
    //         const cache = client.store.getState().apollo.cache;
    //
    //         assert.deepEqual(cache, {
    //           data: finalState.apollo.data,
    //           queryCache: {
    //             '3': {
    //               result: {data: data2},
    //               variables: {},
    //               pointers: {
    //                 'account1': [result.data.node],
    //                 'user1': [result.data.node.owner, result.data.node.users[0]],
    //                 'user2': [result.data.node.users[1]],
    //               }
    //             },
    //           }
    //         });
    //
    //         assert.strictEqual(cache.queryCache['3'].pointers['account1'][0], cache.queryCache['3'].result.data.node);
    //         assert.strictEqual(cache.queryCache['3'].pointers['user1'][0], cache.queryCache['3'].result.data.node.owner);
    //         assert.strictEqual(cache.queryCache['3'].pointers['user1'][1], cache.queryCache['3'].result.data.node.users[0]);
    //         assert.strictEqual(cache.queryCache['3'].pointers['user2'][0], cache.queryCache['3'].result.data.node.users[1]);
    //       });
    //   });
  });

  // it('sitedrive updates query cache after requesting an overlapping query over the network', () => {
  //   const query2 = gql`
  //     query account2 {
  //       node(id: "account1") {
  //         id
  //         name
  //         owner {
  //           id
  //           name
  //         }
  //         users {
  //           id
  //           name
  //         }
  //       }
  //     }
  //   `;
  //
  //   const data2 = {
  //     node: {
  //       id: 'account1',
  //       name: 'Account 1 (updated)',
  //       owner: {
  //         id: 'user1',
  //         name: 'User 1 (updated)',
  //       },
  //       users: [
  //         {
  //           id: 'user1',
  //           name: 'User 1 (updated)'
  //         },
  //         {
  //           id: 'user2',
  //           name: 'User 2 (updated)',
  //         }
  //       ]
  //     },
  //   };
  //
  //   const finalState = cloneDeep(initialState);
  //   finalState.apollo.data['account1']['name'] = data2.node.name;
  //   finalState.apollo.data['user1']['name'] = data2.node.users[0].name;
  //   finalState.apollo.data['user2']['name'] = data2.node.users[1].name;
  //
  //   const networkInterface = mockNetworkInterface({
  //     request: {query},
  //     result: {data},
  //   }, {
  //     request: {query: query2},
  //     result: {data: data2},
  //   });
  //
  //   const client = new ApolloClient({
  //     networkInterface,
  //     addTypename: false,
  //     dataIdFromObject: (obj: any) => obj.id
  //   });
  //
  //   return client.query({query})
  //     .then((result: any) => {
  //       assert.deepEqual(result.data, data);
  //
  //       return client.query({query: query2})
  //         .then((result: any) => {
  //           const cache = client.store.getState().apollo.cache;
  //
  //           assert.deepEqual(cache, {
  //             data: finalState.apollo.data,
  //             queryCache: {
  //               '1': {
  //                 result: {data},
  //                 variables: {},
  //                 pointers: {
  //                   'account1': result.data.node,
  //                   'user1': result.data.node.users[0],
  //                   'user2': result.data.node.users[1]
  //                 }
  //               },
  //               '2': {
  //                 result: {data2},
  //                 variables: {},
  //                 pointers: {
  //                   'account1': result.data.node,
  //                   'user1': result.data.node.users[0],
  //                   'user2': result.data.node.users[1]
  //                 }
  //               }
  //             }
  //           });
  //
  //           assert.strictEqual(cache.queryCache['1'].pointers['account1'], cache.queryCache['1'].result.data.node);
  //           assert.strictEqual(cache.queryCache['1'].pointers['user1'], cache.queryCache['1'].result.data.node.users[0]);
  //           assert.strictEqual(cache.queryCache['1'].pointers['user2'], cache.queryCache['1'].result.data.node.users[1]);
  //         });
  //     });
  // });
});